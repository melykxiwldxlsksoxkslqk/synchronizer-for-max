# -*- coding: utf-8 -*-
"""
ExtensionManager — управление Chrome-расширением BrowserSync.

Отвечает за:
- Проверку и автосборку расширения (npm run build)
- Поиск Chrome/Edge/любого Chromium-браузера на диске
- Запуск браузера с предзагруженным расширением (--load-extension)
- Поддержку кастомного пути к браузеру (Multilogin, GoLogin, AdsPower, etc.)
- Чтение версии расширения из manifest.json
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import winreg
from pathlib import Path
from typing import Optional

logger = logging.getLogger("BrowserSync.ExtensionManager")


class ExtensionManager:
    """Менеджер жизненного цикла Chrome-расширения."""

    def __init__(self, project_root: Optional[str] = None):
        if project_root:
            self._project_root = Path(project_root)
        else:
            self._project_root = Path(__file__).resolve().parent.parent.parent

        self._extension_dir = self._project_root / "browser_sync" / "extension"
        self._dist_dir = self._extension_dir / "dist"
        self._manifest_path = self._extension_dir / "manifest.json"
        self._custom_browser_path: str = ""

    @property
    def extension_dir(self) -> Path:
        return self._extension_dir

    @property
    def custom_browser_path(self) -> str:
        return self._custom_browser_path

    @custom_browser_path.setter
    def custom_browser_path(self, path: str):
        self._custom_browser_path = path.strip() if path else ""

    @property
    def is_built(self) -> bool:
        content_js = self._dist_dir / "content-script.js"
        background_js = self._dist_dir / "background.js"
        return content_js.is_file() and background_js.is_file()

    def read_version(self) -> Optional[str]:
        try:
            with open(self._manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            return manifest.get("version")
        except Exception:
            return None

    def needs_rebuild(self) -> bool:
        if not self.is_built:
            return True

        content_js = self._dist_dir / "content-script.js"
        dist_mtime = content_js.stat().st_mtime

        src_dir = self._extension_dir / "src"
        if not src_dir.is_dir():
            return False

        for root, _dirs, files in os.walk(src_dir):
            for fname in files:
                if fname.endswith((".ts", ".tsx", ".js", ".mjs")):
                    src_path = Path(root) / fname
                    if src_path.stat().st_mtime > dist_mtime:
                        return True
        return False

    def build(self) -> tuple[bool, str]:
        npm_cmd = shutil.which("npm")
        if not npm_cmd:
            return False, "npm не найден в PATH. Установите Node.js."

        node_modules = self._extension_dir / "node_modules"
        if not node_modules.is_dir():
            logger.info("Installing npm dependencies...")
            result = subprocess.run(
                [npm_cmd, "install"],
                cwd=str(self._extension_dir),
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                return False, f"npm install failed: {result.stderr[:500]}"

        logger.info("Building extension...")
        result = subprocess.run(
            [npm_cmd, "run", "build"],
            cwd=str(self._extension_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            return False, f"Build failed: {result.stderr[:500]}"

        version = self.read_version() or "?"
        return True, f"Extension v{version} built successfully"

    def ensure_built(self) -> tuple[bool, str]:
        if not self.needs_rebuild():
            version = self.read_version() or "?"
            return True, f"Extension v{version} is up to date"
        return self.build()

    def find_chrome(self) -> Optional[str]:
        candidates = [
            self._find_chrome_in_registry(),
            self._find_chrome_in_common_paths(),
        ]
        for path in candidates:
            if path and os.path.isfile(path):
                return path
        return shutil.which("chrome") or shutil.which("google-chrome")

    def find_edge(self) -> Optional[str]:
        edge_paths = [
            os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe"),
        ]
        for p in edge_paths:
            if os.path.isfile(p):
                return p
        return shutil.which("msedge")

    def resolve_browser(self) -> tuple[Optional[str], str]:
        """
        Определяет какой браузер использовать.
        Приоритет: кастомный путь → Chrome → Edge.
        Возвращает (path, label).
        """
        if self._custom_browser_path and os.path.isfile(self._custom_browser_path):
            name = Path(self._custom_browser_path).stem
            return self._custom_browser_path, name

        chrome = self.find_chrome()
        if chrome:
            return chrome, "chrome"

        edge = self.find_edge()
        if edge:
            return edge, "edge"

        return None, "none"

    def open_browser_with_extension(
        self, url: str = "https://www.google.com", browser_path_override: str = "",
    ) -> tuple[bool, str]:
        ok, msg = self.ensure_built()
        if not ok:
            return False, msg

        if browser_path_override and os.path.isfile(browser_path_override):
            browser_path = browser_path_override
            browser_label = Path(browser_path).stem
        else:
            browser_path, browser_label = self.resolve_browser()

        if not browser_path:
            return False, (
                "Браузер не найден. Укажи путь к .exe файлу браузера в настройках "
                "(Chrome, Multilogin, GoLogin, AdsPower, Dolphin Anty и т.д.)"
            )

        ext_path = str(self._extension_dir.resolve())

        args = [
            browser_path,
            f"--load-extension={ext_path}",
            url,
        ]

        try:
            subprocess.Popen(
                args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            version = self.read_version() or "?"
            return True, (
                f"{browser_label} запущен с расширением v{version}. "
                f"Если браузер уже был открыт, расширение может не загрузиться — "
                f"закрой все окна этого браузера и попробуй снова."
            )
        except Exception as e:
            return False, f"Не удалось запустить {browser_label}: {e}"

    def get_manual_install_path(self) -> str:
        return str(self._extension_dir.resolve())

    def get_status(self) -> dict:
        version = self.read_version()
        built = self.is_built
        needs_rebuild = self.needs_rebuild() if built else True
        browser_path, browser_label = self.resolve_browser()

        return {
            "version": version,
            "built": built,
            "needs_rebuild": needs_rebuild,
            "extension_path": str(self._extension_dir.resolve()),
            "browser_found": browser_path is not None,
            "browser_type": browser_label,
            "browser_path": browser_path or "",
            "custom_browser_path": self._custom_browser_path,
        }

    def _find_chrome_in_registry(self) -> Optional[str]:
        reg_paths = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
        ]
        for hive, key_path in reg_paths:
            try:
                with winreg.OpenKey(hive, key_path) as key:
                    value, _ = winreg.QueryValueEx(key, "")
                    if value and os.path.isfile(value):
                        return value
            except OSError:
                continue
        return None

    def _find_chrome_in_common_paths(self) -> Optional[str]:
        paths = [
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        ]
        for p in paths:
            if os.path.isfile(p):
                return p
        return None
