#include "audio_capture.h"
#include <napi.h>

// Global capture instance
WasapiLoopbackCapture* g_captureInstance = nullptr;

// Thread-safe callback storage
static Napi::ThreadSafeFunction g_audioCallback;

// ============================================================================
// N-API Wrapper Functions
// ============================================================================

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

// ============================================================================
// Module Initialization
// ============================================================================

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    exports.Set("startCapture", Napi::Function::New(env, StartCapture));
    exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
    exports.Set("getCaptureStatus", Napi::Function::New(env, GetCaptureStatus));
    exports.Set("getProcessList", Napi::Function::New(env, GetProcessList));
    exports.Set("setAudioCallback", Napi::Function::New(env, SetAudioCallback));
    return exports;
}

NODE_API_MODULE(wasi_audio, InitAll)