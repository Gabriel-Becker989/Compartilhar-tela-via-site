#include "audio_capture.h"
#include <napi.h>
#include <windows.h>
#include <tlhelp32.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <avrt.h>
#include <psapi.h>
#include <mmreg.h>
#include <ksmedia.h>
#include <vector>
#include <string>
#include <algorithm>
#include <cmath>

// Windows 11 24H2+ process-loopback activation API (audioclientactivationparams.h).
#if defined(__has_include) && __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#else
enum AUDIOCLIENT_ACTIVATION_TYPE {
    AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
};
enum PROCESS_LOOPBACK_MODE {
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
};
struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
    DWORD TargetProcessId;
    PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
};
struct AUDIOCLIENT_ACTIVATION_PARAMS {
    AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
    union {
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
    };
};
#endif

#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"AUDIO\\VIRTUAL\\DEVICE\\PROCESS_LOOPBACK"
#endif

std::string FormatHr(HRESULT hr) {
    char buf[16];
    snprintf(buf, sizeof(buf), "0x%08X", static_cast<unsigned>(hr));
    return std::string(buf);
}

// Global instance
WasapiLoopbackCapture* g_captureInstance = nullptr;

// ============================================================================
// Async activation handler for the process-loopback (per-process) capture.
// ActivateAudioInterfaceAsync invokes ActivateCompleted on an MTA worker thread;
// we wait on a manual-reset event so the caller can synchronously consume the
// resulting IAudioClient.
// ============================================================================
class ActivationHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
public:
    ActivationHandler() {
        doneEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    }
    virtual ~ActivationHandler() {
        if (doneEvent_) { CloseHandle(doneEvent_); doneEvent_ = nullptr; }
    }

    // IUnknown
    STDMETHODIMP QueryInterface(REFIID riid, void** ppvObj) override {
        if (!ppvObj) return E_POINTER;
        *ppvObj = nullptr;
        if (riid == IID_IUnknown || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
            *ppvObj = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
        } else if (riid == IID_IAgileObject) {
            // Windows may marshal this interface across apartments; advertise
            // agility (as the official sample does) to avoid activation errors.
            *ppvObj = static_cast<IAgileObject*>(this);
        } else {
            return E_NOINTERFACE;
        }
        AddRef();
        return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refCount_); }
    // NOTE: this object is owned by VALUE by WasapiLoopbackCapture — Windows
    // manages its own references around the async activation; we must NEVER
    // delete it from Release() (that would double-free once Windows releases).
    STDMETHODIMP_(ULONG) Release() override { return InterlockedDecrement(&refCount_); }

    // IActivateAudioInterfaceCompletionHandler
    STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
        IUnknown* activatedInterface = nullptr;
        hr_ = operation->GetActivateResult(&hr_, &activatedInterface);
        if (SUCCEEDED(hr_) && activatedInterface) {
            hr_ = activatedInterface->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&audioClient_));
            activatedInterface->Release();
        }
        if (doneEvent_) SetEvent(doneEvent_);
        return S_OK;
    }

    HRESULT Result() const { return hr_; }
    IAudioClient* Client() const { return audioClient_; }
    HANDLE DoneEvent() const { return doneEvent_; }

private:
    volatile LONG refCount_ = 1;
    HRESULT hr_ = E_FAIL;
    IAudioClient* audioClient_ = nullptr;
    HANDLE doneEvent_ = nullptr;
};

// ============================================================================
// WasapiLoopbackCapture Implementation
// ============================================================================

WasapiLoopbackCapture::WasapiLoopbackCapture()
    : activationHandler_(new ActivationHandler()) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
}

WasapiLoopbackCapture::~WasapiLoopbackCapture() {
    Stop();
    
    if (mixFormat_) {
        CoTaskMemFree(mixFormat_);
        mixFormat_ = nullptr;
    }
    
    if (sampleReadyEvent_) {
        CloseHandle(sampleReadyEvent_);
        sampleReadyEvent_ = nullptr;
    }
    delete activationHandler_;
    activationHandler_ = nullptr;
    if (captureClient_) captureClient_->Release();
    if (audioClient_) audioClient_->Release();
    if (renderDevice_) renderDevice_->Release();
    if (deviceEnumerator_) deviceEnumerator_->Release();
    
    CoUninitialize();
}

HRESULT WasapiLoopbackCapture::Initialize(const AudioCaptureConfig& config) {
    config_ = config;
    lastError_.clear();
    
    // Create device enumerator
    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator), (void**)&deviceEnumerator_
    );
    if (FAILED(hr)) {
        lastError_ = "Failed to create device enumerator";
        return hr;
    }
    
    // Get default render device (speakers/headphones)
    hr = deviceEnumerator_->GetDefaultAudioEndpoint(eRender, eConsole, &renderDevice_);
    if (FAILED(hr)) {
        lastError_ = "Failed to get default audio endpoint";
        return hr;
    }
    
    // Activate the appropriate audio client (system loopback or per-process)
    if (config.processId != 0) {
        // Per-process capture (Windows 11 24H2+): use the process-loopback
        // virtual device so ONLY the target process (and its children) audio
        // is captured — not the whole system mix.
        hr = InitializeProcessLoopbackClient(config.processId, config.includeProcessTree);
        if (FAILED(hr)) {
            lastError_ = "Failed to activate process loopback for PID " +
                         std::to_string(config.processId) + ": " + lastError_;
            return hr;
        }
    } else {
        hr = renderDevice_->Activate(
            __uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&audioClient_
        );
        if (FAILED(hr)) {
            lastError_ = "Failed to activate audio client";
            return hr;
        }
    }
    
    // Get mix format — except for per-process loopback, whose capture client
    // does not reliably expose one (GetMixFormat can fail / return null) and
    // rejects float32; the official sample builds the format explicitly.
    if (config.processId != 0) {
        // The per-process virtual device only accepts PCM16 here
        // (float32 -> E_INVALIDARG). ConvertToFloat() later turns it to float32
        // for the JS/WebAudio consumer.
        WAVEFORMATEX* wf = reinterpret_cast<WAVEFORMATEX*>(
            CoTaskMemAlloc(sizeof(WAVEFORMATEX)));
        if (!wf) {
            lastError_ = "Failed to allocate capture format";
            return E_OUTOFMEMORY;
        }
        wf->wFormatTag = WAVE_FORMAT_PCM;
        wf->nChannels = config.channels > 0 ? config.channels : 2;
        wf->nSamplesPerSec = config.sampleRate > 0 ? config.sampleRate : 48000;
        wf->wBitsPerSample = 16;
        wf->nBlockAlign = (wf->nChannels * 16) / 8;
        wf->nAvgBytesPerSec = wf->nSamplesPerSec * wf->nBlockAlign;
        wf->cbSize = 0;
        mixFormat_ = wf;
    } else {
        hr = audioClient_->GetMixFormat(&mixFormat_);
        if (FAILED(hr)) {
            lastError_ = "Failed to get mix format";
            return hr;
        }
    }
    
    // Override the mix format so the capture is 48000 Hz / stereo / float32 —
    // the exact format the JS/WebAudio consumer expects. The previous renderer
    // crash was caused by the TIME_CRITICAL capture thread, not this override.
    // NOTE: the per-process virtual device can return a plain WAVEFORMATEX
    // (not EXTENSIBLE); only write the EXTENSIBLE fields when the allocation
    // actually is one, otherwise we overflow the CoTaskMem'd block.
    if (config.processId == 0 && config.sampleRate > 0 && config.channels > 0) {
        if (mixFormat_->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
            WAVEFORMATEXTENSIBLE* extensible = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mixFormat_);
            extensible->Format.nSamplesPerSec = config.sampleRate;
            extensible->Format.nChannels = config.channels;
            extensible->Format.nBlockAlign = (config.channels * config.bitDepth) / 8;
            extensible->Format.nAvgBytesPerSec = extensible->Format.nSamplesPerSec * extensible->Format.nBlockAlign;
            extensible->Format.wBitsPerSample = config.bitDepth;
            extensible->Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
            extensible->SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
            extensible->dwChannelMask = (config.channels == 2) ? (SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT) : SPEAKER_FRONT_CENTER;
        } else {
            mixFormat_->wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
            mixFormat_->nSamplesPerSec = config.sampleRate;
            mixFormat_->nChannels = config.channels;
            mixFormat_->wBitsPerSample = config.bitDepth;
            mixFormat_->nBlockAlign = (config.channels * config.bitDepth) / 8;
            mixFormat_->nAvgBytesPerSec = mixFormat_->nSamplesPerSec * mixFormat_->nBlockAlign;
        }
    }
    
    // Initialize audio client for loopback capture
    std::string initDetail;
    hr = InitializeAudioClient();
    if (FAILED(hr)) {
        initDetail = lastError_;
        lastError_ = "Failed to initialize audio client for loopback: " + initDetail;
        return hr;
    }
    
    return S_OK;
}

HRESULT WasapiLoopbackCapture::InitializeProcessLoopbackClient(DWORD processId, bool includeTree) {
    // Keep the activation params (including the BLOB pointing at them) alive
    // for the WHOLE async operation, and run the activation from a dedicated
    // thread with its own COM apartment to avoid interfering with (or relying
    // on) the Electron/Node main loop.
    struct ActivationJob {
        AUDIOCLIENT_ACTIVATION_PARAMS params{};
        PROPVARIANT activateParams{};
        ActivationHandler* handler = nullptr;
        HRESULT hr = E_FAIL;
    };
    ActivationJob job;
    job.handler = activationHandler_;
    job.params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    job.params.ProcessLoopbackParams.TargetProcessId = processId;
    job.params.ProcessLoopbackParams.ProcessLoopbackMode =
        includeTree ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                    : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
    PropVariantInit(&job.activateParams);
    job.activateParams.vt = VT_BLOB;
    job.activateParams.blob.cbSize = sizeof(job.params);
    // PropVariantClear() frees BLOB data with CoTaskMemFree() — the blob bytes
    // MUST live in CoTaskMem, not on the stack, or we free a stack pointer.
    job.activateParams.blob.pBlobData =
        reinterpret_cast<BYTE*>(CoTaskMemAlloc(sizeof(job.params)));
    memcpy(job.activateParams.blob.pBlobData, &job.params, sizeof(job.params));
    
    std::thread activationThread([&job]() {
        CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        IActivateAudioInterfaceAsyncOperation* asyncOp = nullptr;
        job.hr = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            __uuidof(IAudioClient),
            &job.activateParams,
            job.handler,
            &asyncOp
        );
        if (SUCCEEDED(job.hr) && asyncOp) {
            // Completion callback fires on the OS' MTA worker thread; wait for it.
            if (job.handler->DoneEvent()) {
                WaitForSingleObject(job.handler->DoneEvent(), 8000);
            }
            asyncOp->Release();
        }
        PropVariantClear(&job.activateParams);
        CoUninitialize();
    });
    activationThread.join();
    
    HRESULT hr = job.handler->Result();
    audioClient_ = job.handler->Client();
    
    if (job.hr != S_OK) hr = job.hr;
    
    if (FAILED(hr)) {
        lastError_ = "activation failed " + FormatHr(hr);
        return hr;
    }
    if (!audioClient_) {
        lastError_ = "activation returned no client";
        return E_FAIL;
    }
    
    return S_OK;
}

HRESULT WasapiLoopbackCapture::InitializeAudioClient() {
    // Initialize for loopback capture
    REFERENCE_TIME hnsRequestedDuration = 10000LL * config_.bufferDurationMs;
    
    HRESULT hr = S_OK;
    
    if (config_.processId != 0) {
        // Per-process loopback: the virtual device only accepts PCM16 with
        // AUTOCONVERTPCM + the high-quality resampler, engine-default period.
        hr = audioClient_->Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK |
                AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            0,
            0,
            mixFormat_,
            nullptr
        );
    } else {
        hr = audioClient_->Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            hnsRequestedDuration,
            0,
            mixFormat_,
            nullptr
        );
    }
    
    if (FAILED(hr)) {
        lastError_ = "Failed to initialize audio client " + FormatHr(hr);
        return hr;
    }
    
    // Get buffer size
    hr = audioClient_->GetBufferSize(&bufferFrameCount_);
    if (FAILED(hr)) {
        lastError_ = "Failed to get buffer size";
        return hr;
    }
    
    // Get capture client
    hr = audioClient_->GetService(__uuidof(IAudioCaptureClient), (void**)&captureClient_);
    if (FAILED(hr)) {
        lastError_ = "Failed to get capture client";
        return hr;
    }
    
    return S_OK;
}

HRESULT WasapiLoopbackCapture::Start() {
    if (isCapturing_.load()) return S_OK;
    if (!audioClient_ || !captureClient_) {
        lastError_ = "Not initialized properly";
        return E_UNEXPECTED;
    }
    
    shouldStop_.store(false);
    isCapturing_.store(true);
    
    // Start audio client
    HRESULT hr = audioClient_->Start();
    if (FAILED(hr)) {
        lastError_ = "Failed to start audio client " + FormatHr(hr);
        isCapturing_.store(false);
        return hr;
    }
    
    // Start processing thread
    processingActive_.store(true);
    processingThread_ = std::thread(&WasapiLoopbackCapture::ProcessingThread, this);
    
    // Start capture thread (normal priority — a TIME_CRITICAL thread polling
    // WASAPI loopback can starve the audio engine and crash other clients,
    // e.g. Chromium's WebAudio renderer).
    captureThread_ = std::thread(&WasapiLoopbackCapture::CaptureThread, this);
    
    return S_OK;
}

HRESULT WasapiLoopbackCapture::Stop() {
    if (!isCapturing_.load()) return S_OK;
    
    shouldStop_.store(true);
    isCapturing_.store(false);
    
    // Stop audio client
    if (audioClient_) {
        audioClient_->Stop();
    }
    
    // Wait for capture thread
    if (captureThread_.joinable()) {
        captureThread_.join();
    }
    
    // Wait for processing thread
    processingActive_.store(false);
    queueCond_.notify_all();
    if (processingThread_.joinable()) {
        processingThread_.join();
    }
    
    return S_OK;
}

void WasapiLoopbackCapture::CaptureThread() {
    // Buffer sized for the FULL engine buffer. GetBuffer() may return any
    // number of frames per packet (up to bufferFrameCount_), so we must be
    // able to hold the worst case.
    std::vector<BYTE> buffer(bufferFrameCount_ * mixFormat_->nBlockAlign);
    
    const DWORD pollInterval = 4; // ms — avoid busy-loop starving other audio clients
    while (!shouldStop_.load()) {
        UINT32 packetLength = 0;
        BYTE* data = nullptr;
        DWORD flags = 0;
        UINT64 devicePosition = 0, qpcPosition = 0;
        
        Sleep(pollInterval);
        if (shouldStop_.load()) break;
        
        UINT32 framesPerPacket = 0;
        HRESULT hr = captureClient_->GetBuffer(&data, &framesPerPacket, &flags, &devicePosition, &qpcPosition);
        
        if (hr == AUDCLNT_S_BUFFER_EMPTY) {
            continue;
        }
        
        if (FAILED(hr) || data == nullptr) {
            continue;
        }
        
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
            // Silence - fill with zeros
            std::fill(buffer.begin(), buffer.end(), 0);
        } else {
            // Copy data (buffer is sized for the worst case, so it always fits)
            size_t bytesToCopy = framesPerPacket * mixFormat_->nBlockAlign;
            memcpy(buffer.data(), data, bytesToCopy);
        }
        
        hr = captureClient_->ReleaseBuffer(framesPerPacket);
        if (FAILED(hr)) continue;
        
        // Convert and queue for processing
        if (framesPerPacket > 0) {
            AudioPacket packet;
            packet.frames = framesPerPacket;
            packet.channels = mixFormat_->nChannels;
            packet.sampleRate = mixFormat_->nSamplesPerSec;
            packet.data.resize(framesPerPacket * packet.channels);
            
            ConvertToFloat(buffer.data(), packet.data.data(), framesPerPacket, mixFormat_);
            
            {
                std::lock_guard<std::mutex> lock(queueMutex_);
                packetQueue_.push(std::move(packet));
            }
            queueCond_.notify_one();
        }
    }
}

void WasapiLoopbackCapture::ProcessingThread() {
    while (processingActive_.load()) {
        AudioPacket packet;
        bool hasPacket = false;
        
        {
            std::unique_lock<std::mutex> lock(queueMutex_);
            queueCond_.wait_for(lock, std::chrono::milliseconds(10), [this] {
                return !packetQueue_.empty() || !processingActive_.load();
            });
            
            if (!packetQueue_.empty()) {
                packet = std::move(packetQueue_.front());
                packetQueue_.pop();
                hasPacket = true;
            }
        }
        
        if (hasPacket) {
            std::lock_guard<std::mutex> lock(callbackMutex_);
            if (dataCallback_) {
                dataCallback_(packet.data.data(), packet.frames, packet.channels, packet.sampleRate);
            }
        }
    }
}

void WasapiLoopbackCapture::ConvertToFloat(const BYTE* source, float* dest, UINT32 frames, WAVEFORMATEX* format) {
    const int channels = format->nChannels;
    const int bitsPerSample = format->wBitsPerSample;
    const UINT32 total = frames * channels;
    
    // GetMixFormat always returns a WAVEFORMATEXTENSIBLE whose wFormatTag is
    // WAVE_FORMAT_EXTENSIBLE (0xFFFE); the real encoding is in SubFormat.
    GUID subtype = {0};
    if (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
        subtype = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(format)->SubFormat;
    }
    const bool isFloat = (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) ||
                         (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
                          IsEqualGUID(subtype, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT));
    
    if (bitsPerSample == 32 && isFloat) {
        // IEEE float32 — direct copy
        memcpy(dest, source, total * sizeof(float));
    } else if (bitsPerSample == 32) {
        // 32-bit PCM integer
        const int32_t* src = reinterpret_cast<const int32_t*>(source);
        for (UINT32 i = 0; i < total; ++i) {
            dest[i] = src[i] / 2147483648.0f;
        }
    } else if (bitsPerSample == 16) {
        const int16_t* src = reinterpret_cast<const int16_t*>(source);
        for (UINT32 i = 0; i < total; ++i) {
            dest[i] = src[i] / 32768.0f;
        }
    } else if (bitsPerSample == 24) {
        // 24-bit packed
        const uint8_t* src = source;
        for (UINT32 i = 0; i < total; ++i) {
            int32_t sample = (src[2] << 16) | (src[1] << 8) | src[0];
            if (sample & 0x800000) sample |= 0xFF000000; // Sign extend
            dest[i] = sample / 8388608.0f;
            src += 3;
        }
    } else if (bitsPerSample == 8) {
        const uint8_t* src = source;
        for (UINT32 i = 0; i < total; ++i) {
            dest[i] = (src[i] - 128) / 128.0f;
        }
    } else {
        // Unknown format — output silence
        memset(dest, 0, total * sizeof(float));
    }
}

// ============================================================================
// ProcessEnumerator Implementation
// ============================================================================

std::vector<ProcessInfo> ProcessEnumerator::GetCaptureableProcesses() {
    std::vector<ProcessInfo> processes;
    
    // Get all windows
    EnumWindows(EnumWindowsCallback, reinterpret_cast<LPARAM>(&processes));
    
    // Sort by process name
    std::sort(processes.begin(), processes.end(), [](const ProcessInfo& a, const ProcessInfo& b) {
        return a.processName < b.processName;
    });
    
    // Remove duplicates (same PID)
    auto last = std::unique(processes.begin(), processes.end(), [](const ProcessInfo& a, const ProcessInfo& b) {
        return a.processId == b.processId;
    });
    processes.erase(last, processes.end());
    
    return processes;
}

BOOL CALLBACK ProcessEnumerator::EnumWindowsCallback(HWND hwnd, LPARAM lParam) {
    if (!IsWindowVisibleAndValid(hwnd)) return TRUE;
    
    std::vector<ProcessInfo>* processes = reinterpret_cast<std::vector<ProcessInfo>*>(lParam);
    
    DWORD processId = 0;
    GetWindowThreadProcessId(hwnd, &processId);
    
    if (processId == 0) return TRUE;
    
    // Skip our own process
    if (processId == GetCurrentProcessId()) return TRUE;
    
    ProcessInfo info;
    info.hwnd = hwnd;
    info.processId = processId;
    info.processName = GetProcessName(processId);
    info.windowTitle = GetWindowTitle(hwnd);
    
    processes->push_back(std::move(info));
    return TRUE;
}

std::wstring ProcessEnumerator::GetProcessName(DWORD processId) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
    if (!hProcess) return L"Unknown";
    
    WCHAR buffer[MAX_PATH];
    DWORD size = MAX_PATH;
    std::wstring name = L"Unknown";
    
    if (QueryFullProcessImageNameW(hProcess, 0, buffer, &size)) {
        // Extract just the filename
        std::wstring fullPath(buffer);
        size_t pos = fullPath.find_last_of(L"\\/");
        if (pos != std::wstring::npos) {
            name = fullPath.substr(pos + 1);
        } else {
            name = fullPath;
        }
    }
    
    CloseHandle(hProcess);
    return name;
}

std::wstring ProcessEnumerator::GetWindowTitle(HWND hwnd) {
    int length = GetWindowTextLengthW(hwnd);
    if (length == 0) return L"";
    
    std::wstring title(length + 1, L'\0');
    GetWindowTextW(hwnd, &title[0], length + 1);
    title.resize(length);
    return title;
}

bool ProcessEnumerator::IsWindowVisibleAndValid(HWND hwnd) {
    if (!IsWindowVisible(hwnd)) return false;
    if (GetWindowTextLengthW(hwnd) == 0) return false;
    
    // Check if it's a real window (not a tool window, etc.)
    LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
    if (exStyle & WS_EX_TOOLWINDOW) return false;
    if (exStyle & WS_EX_NOACTIVATE) return false;
    
    RECT rect;
    GetWindowRect(hwnd, &rect);
    if (rect.right - rect.left < 100 || rect.bottom - rect.top < 100) return false;
    
    return true;
}

// ============================================================================
// N-API Bindings
// ============================================================================

Napi::Object InitAudioCapture(Napi::Env env, Napi::Object exports) {
    exports.Set("startCapture", Napi::Function::New(env, StartCapture));
    exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
    exports.Set("getCaptureStatus", Napi::Function::New(env, GetCaptureStatus));
    exports.Set("getProcessList", Napi::Function::New(env, GetProcessList));
    exports.Set("setAudioCallback", Napi::Function::New(env, SetAudioCallback));
    return exports;
}

Napi::Value StartCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected config object").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    Napi::Object config = info[0].As<Napi::Object>();
    
    AudioCaptureConfig captureConfig;
    captureConfig.processId = config.Get("processId").As<Napi::Number>().Uint32Value();
    captureConfig.includeProcessTree = config.Get("includeProcessTree").As<Napi::Boolean>().Value();
    captureConfig.sampleRate = config.Has("sampleRate") ? config.Get("sampleRate").As<Napi::Number>().Int32Value() : 48000;
    captureConfig.channels = config.Has("channels") ? config.Get("channels").As<Napi::Number>().Int32Value() : 2;
    captureConfig.bitDepth = config.Has("bitDepth") ? config.Get("bitDepth").As<Napi::Number>().Int32Value() : 32;
    captureConfig.bufferDurationMs = config.Has("bufferDurationMs") ? config.Get("bufferDurationMs").As<Napi::Number>().Int32Value() : 20;
    
    // Clean up existing instance
    if (g_captureInstance) {
        delete g_captureInstance;
        g_captureInstance = nullptr;
    }
    
    g_captureInstance = new WasapiLoopbackCapture();
    
    HRESULT hr = g_captureInstance->Initialize(captureConfig);
    if (FAILED(hr)) {
        std::string error = g_captureInstance->GetLastError();
        delete g_captureInstance;
        g_captureInstance = nullptr;
        Napi::Error::New(env, "Failed to initialize capture: " + error).ThrowAsJavaScriptException();
        return env.Null();
    }
    
    hr = g_captureInstance->Start();
    if (FAILED(hr)) {
        std::string error = g_captureInstance->GetLastError();
        delete g_captureInstance;
        g_captureInstance = nullptr;
        Napi::Error::New(env, "Failed to start capture: " + error).ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::Boolean::New(env, true);
}

Napi::Value StopCapture(const Napi::CallbackInfo& info) {
    if (g_captureInstance) {
        g_captureInstance->Stop();
        delete g_captureInstance;
        g_captureInstance = nullptr;
    }
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value GetCaptureStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    if (g_captureInstance) {
        result.Set("isCapturing", g_captureInstance->IsCapturing());
        result.Set("lastError", g_captureInstance->GetLastError());
    } else {
        result.Set("isCapturing", false);
        result.Set("lastError", "");
    }
    
    return result;
}

Napi::Value GetProcessList(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::vector<ProcessInfo> processes = ProcessEnumerator::GetCaptureableProcesses();
    
    Napi::Array result = Napi::Array::New(env, processes.size());
    for (size_t i = 0; i < processes.size(); ++i) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("processId", static_cast<uint32_t>(processes[i].processId));
        obj.Set("processName", Napi::String::New(env, std::string(processes[i].processName.begin(), processes[i].processName.end())));
        obj.Set("windowTitle", Napi::String::New(env, std::string(processes[i].windowTitle.begin(), processes[i].windowTitle.end())));
        obj.Set("hasAudio", processes[i].isAudioActive);
        result.Set(i, obj);
    }
    return result;
}

// Thread-safe callback storage
static void CallJsAudioData(Napi::Env env,
                            Napi::Function jsCallback,
                            void* /*context*/,
                            std::vector<float>* data) {
    if (data == nullptr) return;
    if (env == nullptr) {
        delete data;
        return;
    }

    Napi::ArrayBuffer buffer = Napi::ArrayBuffer::New(env, data->size() * sizeof(float));
    if (data->size() > 0) {
        float* dest = static_cast<float*>(buffer.Data());
        memcpy(dest, data->data(), data->size() * sizeof(float));
    }

    Napi::TypedArray typedArray = Napi::Float32Array::New(env, data->size(), buffer, 0);
    jsCallback.Call({typedArray});
    delete data;
}

using AudioDataTSFN = Napi::TypedThreadSafeFunction<void, std::vector<float>, CallJsAudioData>;
static AudioDataTSFN g_audioCallback;

Napi::Value SetAudioCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    Napi::Function callback = info[0].As<Napi::Function>();
    
    // Create thread-safe function
    g_audioCallback = AudioDataTSFN::New(
        env,
        callback,
        "AudioDataCallback",
        0,  // unlimited queue
        1   // only 1 thread will call
    );
    
    // Set callback on capture instance
    if (g_captureInstance) {
        g_captureInstance->SetDataCallback([](const float* data, size_t frames, int channels, int sampleRate) {
            // Call thread-safe function (non-blocking)
            g_audioCallback.NonBlockingCall(new std::vector<float>(data, data + frames * channels));
        });
    }
    
    return Napi::Boolean::New(env, true);
}

// Module registration
Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return InitAudioCapture(env, exports);
}

NODE_API_MODULE(wasi_audio, InitAll)
