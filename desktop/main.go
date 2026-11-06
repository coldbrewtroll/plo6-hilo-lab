// PLO6 Hi/Lo Lab — Windows desktop wrapper.
// Embeds the single-file app, serves it on a local port, and shows it in a native
// window using the WebView2 runtime that ships with Windows 10/11.
package main

import (
	_ "embed"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

//go:embed app.html
var appHTML []byte

// Fixed port so the page origin (and therefore saved stats/settings) stays the same between runs.
const preferredAddr = "127.0.0.1:47809"

func serve() string {
	ln, err := net.Listen("tcp", preferredAddr)
	if err != nil { // another copy is running or the port is taken
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			fatal("Could not start the local app server: " + err.Error())
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(appHTML)
	})
	go http.Serve(ln, mux)
	return "http://" + ln.Addr().String() + "/"
}

func messageBox(text, title string, flags uintptr) {
	user32 := syscall.NewLazyDLL("user32.dll")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
}

func fatal(msg string) {
	messageBox(msg, "PLO6 Hi/Lo Lab", 0x10) // MB_ICONERROR
	os.Exit(1)
}

func main() {
	url := serve()
	dataDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "PLO6HiLoLab")
	os.MkdirAll(dataDir, 0o755)

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  dataDir,
		WindowOptions: webview2.WindowOptions{
			Title:  "PLO6 Hi/Lo Lab — 6-Card Omaha 8 Sim & Trainer",
			Width:  1480,
			Height: 980,
			Center: true,
		},
	})
	if w == nil {
		// No WebView2 runtime: fall back to the default browser while this process keeps serving.
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		messageBox("Microsoft Edge WebView2 Runtime was not found, so PLO6 Hi/Lo Lab opened in your web browser instead.\n\n"+
			"Keep this box open while you use it. Click OK to quit.\n\n"+
			"(Install the WebView2 Runtime from Microsoft to get the app window.)", "PLO6 Hi/Lo Lab", 0x40)
		return
	}
	defer w.Destroy()
	w.SetSize(1180, 760, webview2.HintMin)
	w.Navigate(url)
	w.Run()
}
