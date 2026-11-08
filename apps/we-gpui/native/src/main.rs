use gpui_kit::*;
use gpui_webview::WebView;

struct Probe {
    webview: Option<Entity<WebView>>,
    error: Option<String>,
}

impl Render for Probe {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let body = match (&self.webview, &self.error) {
            (Some(view), _) => div().flex_1().child(view.clone()).into_any_element(),
            (None, Some(e)) => div().p_4().child(e.clone()).into_any_element(),
            _ => div().into_any_element(),
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(0x1e1e2e))
            .text_color(rgb(0xffffff))
            .child(div().p_2().child("GPUI header (native)"))
            .child(body)
    }
}

fn main() {
    env_logger::init();
    let modes = match std::env::var("WE_GPUI_WINDOWING").as_deref() {
        Ok("wayland") => WindowingModes::WAYLAND,
        _ => WindowingModes::X11,
    };
    gpui_kit::platform::linux(modes).run(|cx| {
        gpui_kit::init(cx);
        let url = std::env::var("WE_GPUI_URL").unwrap_or("https://example.com".into());
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1000.), px(700.)),
                    cx,
                ))),
                ..Default::default()
            },
            cx,
            move |window, cx| {
                if std::env::var("WE_GPUI_RAW_WRY").is_ok() {
                    // wry's own answer, without gpui-webview's X11 guard in front of it.
                    gtk::gdk::set_allowed_backends("wayland,x11");
                    let _ = gtk::init();
                    let raw = wry::WebViewBuilder::new().with_url(&url).build_as_child(&*window);
                    eprintln!("raw wry build_as_child: {:?}", raw.as_ref().map(|_| "ok").map_err(|e| e.to_string()));
                }
                let built = WebView::build(wry::WebViewBuilder::new().with_url(&url), window, cx);
                cx.new(|cx| match built {
                    Ok(w) => Probe { webview: Some(cx.new(|_| w)), error: None },
                    Err(e) => {
                        eprintln!("webview build failed: {e}");
                        Probe { webview: None, error: Some(format!("webview: {e}")) }
                    }
                })
            },
        )
        .unwrap();
    });
}
