# Quick scan test
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from browser_sync.adapters.win32.window_service import Win32WindowService, _get_exe_name

svc = Win32WindowService()

# All visible windows
all_wins = svc._get_all_visible_windows()
print(f"All visible windows (w>200, h>200): {len(all_wins)}")
for w in all_wins:
    exe = _get_exe_name(w.pid)
    print(f"  hwnd={w.hwnd} pid={w.pid} exe={exe:25s} title={w.title[:60]}")

print()

# Browser scan with default keywords
from browser_sync.core.models.config import SyncConfig
cfg = SyncConfig()
browsers = svc.scan_browser_windows(cfg.browser_window_keywords)
print(f"\nBrowser windows found: {len(browsers)}")
for w in browsers:
    exe = _get_exe_name(w.pid)
    print(f"  hwnd={w.hwnd} pid={w.pid} exe={exe:25s} title={w.title[:60]}")
