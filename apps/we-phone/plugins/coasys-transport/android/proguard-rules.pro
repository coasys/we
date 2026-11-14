# The uniffi bindings reach the Rust library through JNA, which finds classes and fields by name.
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keep class uniffi.we_phone_transport.** { *; }
