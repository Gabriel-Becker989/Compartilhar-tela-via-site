#include "audio_capture.h"
#include <napi.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <avrt.h>
#include <psapi.h>
#include <vector>
#include <string>
#include <algorithm>
#include <cmath>

// Global instance
WasapiLoopbackCapture* g_captureInstance = nullptr;

// ============================================================================
// WasapiLoopbackCapture Implementation
// ============================================================================

WasapiLoopbackCapture::WasapiLoopbackCapture() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
}

WasapiLoopbackCapture::~WasapiLoopbackCapture() {
    Stop();
    
    if (mixFormat_) {
        CoTaskMemFree(mixFormat_);
        mixFormat_ = nullptr;
    }
    
    if (targetSession_) targetSession_->Release();
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
    
    // Activate audio client
    hr = renderDevice_->Activate(
        __uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&audioClient_
    );
    if (FAILED(hr)) {
        lastError_ = "Failed to activate audio client";
        return hr;
    }
    
    // Get mix format
    hr = audioClient_->GetMixFormat(&mixFormat_);
    if (FAILED(hr)) {
        lastError_ = "Failed to get mix format";
        return hr;
    }
    
    // Override with our desired format if needed
    if (config.sampleRate > 0 && config.channels > 0) {
        WAVEFORMATEXTENSIBLE* extensible = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mixFormat_);
        extensible->Format.nSamplesPerSec = config.sampleRate;
        extensible->Format.nChannels = config.channels;
        extensible->Format.nBlockAlign = (config.channels * config.bitDepth) / 8;
        extensible->Format.nAvgBytesPerSec = extensible->Format.nSamplesPerSec * extensible->Format.nBlockAlign;
        extensible->Format.wBitsPerSample = config.bitDepth;
        extensible->Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
        extensible->SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
        extensible->dwChannelMask = (config.channels == 2) ? (SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT) : SPEAKER_MONO;
    }
    
    // Find target audio session by PID
    hr = FindTargetAudioSession();
    if (FAILED(hr)) {
        lastError_ = "Failed to find audio session for PID " + std::to_string(config.processId);
        return hr;
    }
    
    // Initialize audio client for loopback capture
    hr = InitializeAudioClient();
    if (FAILED(hr)) {
        lastError_ = "Failed to initialize audio client for loopback";
        return hr;
    }
    
    return S_OK;
}

HRESULT WasapiLoopbackCapture::FindTargetAudioSession() {
    // Get audio session manager
    IAudioSessionManager2* sessionManager = nullptr;
    HRESULT hr = renderDevice_->Activate(
        __uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&sessionManager
    );
    if (FAILED(hr)) {
        lastError_ = "Failed to activate session manager";
        return hr;
    }
    
    // Get session enumerator
    IAudioSessionEnumerator* sessionEnumerator = nullptr;
    hr = sessionManager->GetSessionEnumerator(&sessionEnumerator);
    if (FAILED(hr)) {
        sessionManager->Release();
        lastError_ = "Failed to get session enumerator";
        return hr;
    }
    
    int count = 0;
    hr = sessionEnumerator->GetCount(&count);
    if (FAILED(hr)) {
        sessionEnumerator->Release();
        sessionManager->Release();
        lastError_ = "Failed to get session count";
        return hr;
    }
    
    // Enumerate sessions to find matching PID
    for (int i = 0; i < count; ++i) {
        IAudioSessionControl* sessionControl = nullptr;
        hr = sessionEnumerator->GetSession(i, &sessionControl);
        if (FAILED(hr)) continue;
        
        IAudioSessionControl2* sessionControl2 = nullptr;
        hr = sessionControl->QueryInterface(__uuidof(IAudioSessionControl2), (void**)&sessionControl2);
        sessionControl->Release();
        if (FAILED(hr)) continue;
        
        DWORD sessionPid = 0;
        hr = sessionControl2->GetProcessId(&sessionPid);
        if (FAILED(hr)) {
            sessionControl2->Release();
            continue;
        }
        
        // Check if this PID matches our target (or is in tree)
        bool matches = false;
        if (sessionPid == config_.processId) {
            matches = true;
        } else if (config_.includeProcessTree) {
            matches = IsPidInTree(sessionPid, config_.processId);
        }
        
        if (matches) {
            // Found matching session
            targetSession_ = sessionControl2;
            sessionEnumerator->Release();
            sessionManager->Release();
            return S_OK;
        }
        
        sessionControl2->Release();
    }
    
    sessionEnumerator->Release();
    sessionManager->Release();
    lastError_ = "No audio session found for PID " + std::to_string(config_.processId);
    return E_NOTFOUND;
}

bool WasapiLoopbackCapture::IsPidInTree(DWORD pid, DWORD targetPid) {
    if (pid == targetPid) return true;
    
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnapshot == INVALID_HANDLE_VALUE) return false;
    
    PROCESSENTRY32W pe32;
    pe32.dwSize = sizeof(PROCESSENTRY32W);
    
    bool found = false;
    if (Process32FirstW(hSnapshot, &pe32)) {
        do {
            if (pe32.th32ProcessID == pid) {
                // Found the process, now check parent chain
                DWORD currentPid = pid;
                while (currentPid != 0 && currentPid != targetPid) {
                    bool parentFound = false;
                    HANDLE hSnap2 = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
                    if (hSnap2 != INVALID_HANDLE_VALUE) {
                        PROCESSENTRY32W pe32_2;
                        pe32_2.dwSize = sizeof(PROCESSENTRY32W);
                        if (Process32FirstW(hSnap2, &pe32_2)) {
                            do {
                                if (pe32_2.th32ProcessID == currentPid) {
                                    currentPid = pe32_2.th32ParentProcessID;
                                    parentFound = true;
                                    break;
                                }
                            } while (Process32NextW(hSnap2, &pe32_2));
                        }
                        CloseHandle(hSnap2);
                    }
                    if (!parentFound) break;
                }
                found = (currentPid == targetPid);
                break;
            }
        } while (Process32NextW(hSnapshot, &pe32));
    }
    
    CloseHandle(hSnapshot);
    return found;
}

HRESULT WasapiLoopbackCapture::InitializeAudioClient() {
    // Initialize for loopback capture
    REFERENCE_TIME hnsRequestedDuration = REFTIMES_PER_MILLISEC * config_.bufferDurationMs;
    
    HRESULT hr = audioClient_->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        hnsRequestedDuration,
        0,
        mixFormat_,
        nullptr
    );
    
    if (FAILED(hr)) {
        lastError_ = "Failed to initialize audio client: " + std::to_string(hr);
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
    if (!audioClient_ || !captureClient_ || !targetSession_) {
        lastError_ = "Not initialized properly";
        return E_UNEXPECTED;
    }
    
    shouldStop_.store(false);
    isCapturing_.store(true);
    
    // Start audio client
    HRESULT hr = audioClient_->Start();
    if (FAILED(hr)) {
        lastError_ = "Failed to start audio client";
        isCapturing_.store(false);
        return hr;
    }
    
    // Start processing thread
    processingActive_.store(true);
    processingThread_ = std::thread(&WasapiLoopbackCapture::ProcessingThread, this);
    
    // Start capture thread
    captureThread_ = std::thread(&WasapiLoopbackCapture::CaptureThread, this);
    
    // Set thread priority for low latency
    SetThreadPriority(captureThread_.native_handle(), THREAD_PRIORITY_TIME_CRITICAL);
    
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
    HANDLE hTask = AvSetMmThreadCharacteristics(L"Audio", nullptr);
    
    const UINT32 framesPerPacket = bufferFrameCount_ / 4; // Process in smaller chunks
    std::vector<BYTE> buffer(framesPerPacket * mixFormat_->nBlockAlign);
    
    while (!shouldStop_.load()) {
        UINT32 packetLength = 0;
        BYTE* data = nullptr;
        DWORD flags = 0;
        UINT64 devicePosition = 0, qpcPosition = 0;
        
        HRESULT hr = captureClient_->GetBuffer(&data, &framesPerPacket, &flags, &devicePosition, &qpcPosition);
        
        if (hr == AUDCLNT_S_BUFFER_EMPTY) {
            Sleep(1);
            continue;
        }
        
        if (FAILED(hr) || data == nullptr) {
            continue;
        }
        
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
            // Silence - fill with zeros
            std::fill(buffer.begin(), buffer.end(), 0);
        } else {
            // Copy data
            size_t bytesToCopy = framesPerPacket * mixFormat_->nBlockAlign;
            if (bytesToCopy <= buffer.size()) {
                memcpy(buffer.data(), data, bytesToCopy);
            }
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
    
    if (hTask) AvRevertMmThreadCharacteristics(hTask);
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
    const int bytesPerSample = bitsPerSample / 8;
    
    if (bitsPerSample == 16 && format->wFormatTag == WAVE_FORMAT_PCM) {
        const int16_t* src = reinterpret_cast<const int16_t*>(source);
        for (UINT32 i = 0; i < frames * channels; ++i) {
            dest[i] = src[i] / 32768.0f;
        }
    } else if (bitsPerSample == 32 && format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
        const float* src = reinterpret_cast<const float*>(source);
        memcpy(dest, source, frames * channels * sizeof(float));
    } else if (bitsPerSample == 24) {
        // 24-bit packed
        const uint8_t* src = source;
        for (UINT32 i = 0; i < frames * channels; ++i) {
            int32_t sample = (src[2] << 16) | (src[1] << 8) | src[0];
            if (sample & 0x800000) sample |= 0xFF000000; // Sign extend
            dest[i] = sample / 8388608.0f;
            src += 3;
        }
    } else {
        // Default fallback - treat as 16-bit
        const int16_t* src = reinterpret_cast<const int16_t*>(source);
        for (UINT32 i = 0; i < frames * channels; ++i) {
            dest[i] = src[i] / 32768.0f;
        }
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
static Napi::ThreadSafeFunction g_audioCallback;

Napi::Value SetAudioCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    Napi::Function callback = info[0].As<Napi::Function>();
    
    // Create thread-safe function
    g_audioCallback = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "AudioDataCallback",
        0,  // unlimited queue
        1,  // only 1 thread will call
        [](Napi::Env) {},  // no finalizer needed
        [](Napi::Env env, Napi::Function jsCallback, const std::vector<float>& data) {
            // Create Float32Array from data
            Napi::ArrayBuffer buffer = Napi::ArrayBuffer::New(env, data.size() * sizeof(float));
            float* dest = static_cast<float*>(buffer.Data());
            memcpy(dest, data.data(), data.size() * sizeof(float));
            
            Napi::TypedArray typedArray = Napi::Float32Array::New(env, data.size(), buffer, 0);
            jsCallback.Call({typedArray});
        }
    );
    
    // Set callback on capture instance
    if (g_captureInstance) {
        g_captureInstance->SetDataCallback([](const float* data, size_t frames, int channels, int sampleRate) {
            std::vector<float> audioData(data, data + frames * channels);
            
            // Call thread-safe function (non-blocking)
            g_audioCallback.NonBlockingCall(audioData);
        });
    }
    
    return Napi::Boolean::New(env, true);
}

// Module registration
Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return InitAudioCapture(env, exports);
}

NODE_API_MODULE(wasi_audio, InitAll)