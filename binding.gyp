{
  "targets": [
    {
      "target_name": "wasi_audio",
      "type": "loadable_module",
      "sources": ["src/native/stub.cc"],
      "include_dirs": [
        "node_modules/node-addon-api",
        "src/native"
      ],
      "dependencies": [
        "node_modules/node-addon-api/node_api.gyp:nothing"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "WASI_AUDIO_STUB=1"
      ],
      "conditions": [
        ["OS=='win'", {
          "sources": [
            "src/native/audio_capture.cc"
          ],
          "sources!": [
            "src/native/stub.cc"
          ],
          "libraries": [
            "-lole32",
            "-loleaut32",
            "-lmmdevapi",
            "-luuid",
            "-lavrt"
          ],
          "defines!": ["WASI_AUDIO_STUB=1"]
        }]
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"]
    }
  ]
}