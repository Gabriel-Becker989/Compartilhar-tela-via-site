{
  "targets": [
    {
      "target_name": "wasi_audio",
      "type": "shared_library",
      "sources": ["src/native/stub.cc"],
      "include_dirs": [
        "<!(node -e \"require('node-addon-api').include_dir\")",
        "src/native"
      ],
      "dependencies": [
        "<!(node -e \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "WASI_AUDIO_STUB=1"
      ],
      "conditions": [
        ["OS=='win'", {
          "sources": [
            "src/native/audio_capture.cc",
            "src/native/process_enumerator.cc",
            "src/native/napi_bindings.cc"
          ],
          "libraries": [
            "-lole32",
            "-loleaut32",
            "-lmmdevapi",
            "-luuid"
          ],
          "defines!": ["WASI_AUDIO_STUB=1"]
        }]
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"]
    }
  ]
}
