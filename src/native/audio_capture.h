#pragma once

#include <napi.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <avrt.h>
#include <psapi.h>
#include <vector>
#include <string>
#include <memory>
#include <functional>
#include <atomic>
#include <mutex>
#include <thread>
#include <queue>
#include <condition_variable>

// Forward declarations
struct AudioCaptureConfig;
struct ProcessInfo;

// Configuration for audio capture
struct AudioCaptureConfig {
    DWORD processId = 0;
    bool includeProcessTree = true;
    int sampleRate = 48000;
    int channels = 2;
    int bitDepth = 16;
    int bufferDurationMs = 20;
};

// Information about a captureable process/window
struct ProcessInfo {
    DWORD processId = 0;
    std::wstring processName;
    std::wstring windowTitle;
    HWND hwnd = nullptr;
    bool isAudioActive = false;
};

// Callback for audio data
using AudioDataCallback = std::function<void(const float* data, size_t frames, int channels, int sampleRate)>;

// Main audio capture class using WASAPI Loopback
class WasapiLoopbackCapture {
public:
    WasapiLoopbackCapture();
    ~WasapiLoopbackCapture();

    // Initialize capture for a specific process
    HRESULT Initialize(const AudioCaptureConfig& config);
    
    // Start capturing
    HRESULT Start();
    
    // Stop capturing
    HRESULT Stop();
    
    // Check if currently capturing
    bool IsCapturing() const { return isCapturing_.load(); }
    
    // Set audio data callback
    void SetDataCallback(AudioDataCallback callback) { dataCallback_ = std::move(callback); }
    
    // Get last error message
    std::string GetLastError() const { return lastError_; }

private:
    // Internal capture thread function
    void CaptureThread();
    
    // Initialize audio client for loopback
    HRESULT InitializeAudioClient();
    
    // Find the audio session for our target process
    HRESULT FindTargetAudioSession();
    
    // Enumerate audio sessions and find matching PID
    HRESULT EnumerateSessionsForPID(DWORD targetPid, bool includeTree, IAudioSessionControl2** outSession);
    
    // Convert audio format to float
    void ConvertToFloat(const BYTE* source, float* dest, UINT32 frames, WAVEFORMATEX* format);
    
    // Helper to check if PID is in process tree
    bool IsPidInTree(DWORD pid, DWORD targetPid);

    // COM objects
    IMMDeviceEnumerator* deviceEnumerator_ = nullptr;
    IMMDevice* renderDevice_ = nullptr;
    IAudioClient* audioClient_ = nullptr;
    IAudioCaptureClient* captureClient_ = nullptr;
    IAudioSessionControl2* targetSession_ = nullptr;
    
    // Audio format
    WAVEFORMATEX* mixFormat_ = nullptr;
    UINT32 bufferFrameCount_ = 0;
    
    // Configuration
    AudioCaptureConfig config_;
    
    // Threading
    std::atomic<bool> isCapturing_{false};
    std::atomic<bool> shouldStop_{false};
    std::thread captureThread_;
    std::mutex callbackMutex_;
    AudioDataCallback dataCallback_;
    
    // Error tracking
    std::string lastError_;
    
    // Work queue for audio data (to avoid blocking audio thread)
    struct AudioPacket {
        std::vector<float> data;
        size_t frames;
        int channels;
        int sampleRate;
    };
    std::queue<AudioPacket> packetQueue_;
    std::mutex queueMutex_;
    std::condition_variable queueCond_;
    std::thread processingThread_;
    std::atomic<bool> processingActive_{false};
    
    void ProcessingThread();
};

// Process enumerator for getting list of windows/processes
class ProcessEnumerator {
public:
    static std::vector<ProcessInfo> GetCaptureableProcesses();
    
private:
    static BOOL CALLBACK EnumWindowsCallback(HWND hwnd, LPARAM lParam);
    static std::wstring GetProcessName(DWORD processId);
    static std::wstring GetWindowTitle(HWND hwnd);
    static bool IsWindowVisibleAndValid(HWND hwnd);
};

// N-API wrapper functions
Napi::Object InitAudioCapture(Napi::Env env, Napi::Object exports);
Napi::Value StartCapture(const Napi::CallbackInfo& info);
Napi::Value StopCapture(const Napi::CallbackInfo& info);
Napi::Value GetCaptureStatus(const Napi::CallbackInfo& info);
Napi::Value GetProcessList(const Napi::CallbackInfo& info);
Napi::Value SetAudioCallback(const Napi::CallbackInfo& info);

// Global capture instance (singleton pattern for simplicity)
extern WasapiLoopbackCapture* g_captureInstance;