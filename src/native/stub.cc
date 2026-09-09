// Stub implementation for non-Windows platforms (Linux/macOS)
// This allows the project to build and run on non-Windows systems for development

#include <napi.h>
#include <vector>
#include <string>

// Stub types matching the Windows implementation
struct AudioCaptureConfig {
    uint32_t processId = 0;
    bool includeProcessTree = true;
    int sampleRate = 48000;
    int channels = 2;
    int bitDepth = 32;
    int bufferDurationMs = 20;
};

struct ProcessInfo {
    uint32_t processId = 0;
    std::string processName;
    std::string windowTitle;
    bool isAudioActive = false;
};

using AudioDataCallback = std::function<void(const float* data, size_t frames, int channels, int sampleRate)>;

// Stub WasapiLoopbackCapture class
class WasapiLoopbackCapture {
public:
    WasapiLoopbackCapture() {}
    ~WasapiLoopbackCapture() {}
    
    int Initialize(const AudioCaptureConfig& config) {
        (void)config;
        return 0; // S_OK
    }
    
    int Start() { return 0; }
    int Stop() { return 0; }
    bool IsCapturing() const { return false; }
    void SetDataCallback(AudioDataCallback callback) { (void)callback; }
    std::string GetLastError() const { return "Stub implementation - Windows only"; }
};

// Stub ProcessEnumerator class
class ProcessEnumerator {
public:
    static std::vector<ProcessInfo> GetCaptureableProcesses() {
        // Return some mock processes for testing
        std::vector<ProcessInfo> processes;
        
        ProcessInfo p1;
        p1.processId = 1234;
        p1.processName = "Terraria.exe";
        p1.windowTitle = "Terraria - Single Player";
        p1.isAudioActive = true;
        processes.push_back(p1);
        
        ProcessInfo p2;
        p2.processId = 5678;
        p2.processName = "chrome.exe";
        p2.windowTitle = "YouTube - Google Chrome";
        p2.isAudioActive = true;
        processes.push_back(p2);
        
        ProcessInfo p3;
        p3.processId = 9012;
        p3.processName = "Discord.exe";
        p3.windowTitle = "Discord";
        p3.isAudioActive = true;
        processes.push_back(p3);
        
        ProcessInfo p4;
        p4.processId = 3456;
        p4.processName = "System Audio";
        p4.windowTitle = "Som do Sistema (Padrão)";
        p4.isAudioActive = true;
        processes.push_back(p4);
        
        return processes;
    }
};

// Global stub instance
static WasapiLoopbackCapture* g_captureInstance = nullptr;
static Napi::ThreadSafeFunction g_audioCallback;

// N-API Stubs
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
    
    if (g_captureInstance) {
        delete g_captureInstance;
        g_captureInstance = nullptr;
    }
    
    g_captureInstance = new WasapiLoopbackCapture();
    
    int hr = g_captureInstance->Initialize(captureConfig);
    if (hr != 0) {
        std::string error = g_captureInstance->GetLastError();
        delete g_captureInstance;
        g_captureInstance = nullptr;
        Napi::Error::New(env, "Failed to initialize capture: " + error).ThrowAsJavaScriptException();
        return env.Null();
    }
    
    hr = g_captureInstance->Start();
    if (hr != 0) {
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
        result.Set("lastError", "Stub - Windows only");
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
        obj.Set("processName", Napi::String::New(env, processes[i].processName));
        obj.Set("windowTitle", Napi::String::New(env, processes[i].windowTitle));
        obj.Set("hasAudio", processes[i].isAudioActive);
        result.Set(i, obj);
    }
    return result;
}

static Napi::ThreadSafeFunction g_audioCallback;

Napi::Value SetAudioCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    Napi::Function callback = info[0].As<Napi::Function>();
    
    g_audioCallback = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "AudioDataCallback",
        0,
        1,
        [](Napi::Env) {},
        [](Napi::Env env, Napi::Function jsCallback, const std::vector<float>& data) {
            Napi::ArrayBuffer buffer = Napi::ArrayBuffer::New(env, data.size() * sizeof(float));
            float* dest = static_cast<float*>(buffer.Data());
            memcpy(dest, data.data(), data.size() * sizeof(float));
            
            Napi::TypedArray typedArray = Napi::Float32Array::New(env, data.size(), buffer, 0);
            jsCallback.Call({typedArray});
        }
    );
    
    if (g_captureInstance) {
        g_captureInstance->SetDataCallback([](const float* data, size_t frames, int channels, int sampleRate) {
            std::vector<float> audioData(data, data + frames * channels);
            g_audioCallback.NonBlockingCall(audioData);
        });
    }
    
    return Napi::Boolean::New(env, true);
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    exports.Set("startCapture", Napi::Function::New(env, StartCapture));
    exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
    exports.Set("getCaptureStatus", Napi::Function::New(env, GetCaptureStatus));
    exports.Set("getProcessList", Napi::Function::New(env, GetProcessList));
    exports.Set("setAudioCallback", Napi::Function::New(env, SetAudioCallback));
    return exports;
}

NODE_API_MODULE(wasi_audio, InitAll)