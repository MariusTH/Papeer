//! Native tablet support (macOS), like Krita: WKWebView reports Wacom-style pens as a
//! plain mouse and never exposes the eraser end, so we read AppKit tablet events directly
//! and forward them to the frontend.
//!
//! - `tablet://proximity` { entering, device: "pen" | "eraser" | "cursor" | "unknown" }
//! - `tablet://pressure`  { pressure }   (only while the pen touches the surface)
//!
//! On Windows and Linux the webview already reports pen pressure, so this is a no-op there.
#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_imports))]

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct Proximity {
    entering: bool,
    device: &'static str,
}

#[derive(Clone, Serialize)]
struct Pressure {
    pressure: f32,
}

#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventSubtype, NSEventType, NSPointingDeviceType};
    use std::ptr::NonNull;

    let app = app.clone();
    let handler = RcBlock::new(move |ev: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit hands us a valid event for the duration of the callback.
        let event = unsafe { ev.as_ref() };
        let ty = event.r#type();
        let is_mouse = ty == NSEventType::LeftMouseDown
            || ty == NSEventType::LeftMouseUp
            || ty == NSEventType::LeftMouseDragged
            || ty == NSEventType::RightMouseDown
            || ty == NSEventType::RightMouseUp
            || ty == NSEventType::RightMouseDragged
            || ty == NSEventType::OtherMouseDown
            || ty == NSEventType::OtherMouseUp
            || ty == NSEventType::OtherMouseDragged
            || ty == NSEventType::MouseMoved;
        // `subtype` is only valid on mouse/tablet events (it throws on others).
        let subtype = if is_mouse { Some(event.subtype()) } else { None };

        if ty == NSEventType::TabletProximity || subtype == Some(NSEventSubtype::TabletProximity) {
            let device = match event.pointingDeviceType() {
                NSPointingDeviceType::Pen => "pen",
                NSPointingDeviceType::Eraser => "eraser",
                NSPointingDeviceType::Cursor => "cursor",
                _ => "unknown",
            };
            let _ = app.emit(
                "tablet://proximity",
                Proximity { entering: event.isEnteringProximity(), device },
            );
        } else if ty == NSEventType::TabletPoint || subtype == Some(NSEventSubtype::TabletPoint) {
            let touching = ty != NSEventType::MouseMoved;
            if touching {
                let _ = app.emit("tablet://pressure", Pressure { pressure: event.pressure() });
            }
        }
        ev.as_ptr()
    });

    let mask = NSEventMask::TabletProximity
        | NSEventMask::TabletPoint
        | NSEventMask::LeftMouseDown
        | NSEventMask::LeftMouseUp
        | NSEventMask::LeftMouseDragged
        | NSEventMask::RightMouseDown
        | NSEventMask::RightMouseUp
        | NSEventMask::RightMouseDragged
        | NSEventMask::OtherMouseDown
        | NSEventMask::OtherMouseUp
        | NSEventMask::OtherMouseDragged
        | NSEventMask::MouseMoved;

    // SAFETY: called on the main thread during setup; the handler returns the event unchanged.
    // AppKit merges mouse/tablet events to one per frame by default. Turn that off so every
    // tablet sample (often 200+ Hz) reaches the webview; fast, small handwriting then keeps
    // its shape instead of being drawn from a few widely spaced points.
    NSEvent::setMouseCoalescingEnabled(false);

    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) };
    // The monitor must live for the whole app lifetime.
    std::mem::forget(monitor);
}

/// Other platforms: WebView2 / WebKitGTK report pens (and the eraser button) via Pointer Events.
#[cfg(not(target_os = "macos"))]
pub fn install(_app: &AppHandle) {}
