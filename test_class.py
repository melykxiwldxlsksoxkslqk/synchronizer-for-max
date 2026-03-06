# Check class names
import win32gui
for hwnd in [66794, 198840, 4327714]:
    try:
        cn = win32gui.GetClassName(hwnd)
        title = win32gui.GetWindowText(hwnd)
        print(f"hwnd={hwnd} class='{cn}' title='{title[:50]}'")
    except:
        print(f"hwnd={hwnd} - not found")
