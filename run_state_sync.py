"""
Run room-based state synchronization server.
"""

import uvicorn

from browser_sync.state_sync.app import create_app


if __name__ == "__main__":
    uvicorn.run(create_app(), host="127.0.0.1", port=8000)

