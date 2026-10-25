import sys
from pathlib import Path
root = Path("c:/Users/Tenders/octo/octo")
sys.path.insert(0, str(root))

from memory.config_manager import save_proxy_keys, load_proxy_keys

try:
    print("Loading proxy keys...")
    print(load_proxy_keys())
    print("Saving proxy keys...")
    save_proxy_keys({"nvidia_nim_api_key": "test_key_123"})
    print("Saved.")
except Exception as e:
    import traceback
    traceback.print_exc()
