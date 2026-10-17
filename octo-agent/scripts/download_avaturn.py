"""
download_avaturn.py
===================
Utility script to connect to the Avaturn API or direct download URLs and
automatically download and verify a rigged 3D avatar GLB file with lipsync support.

Usage:
  1. Direct URL download:
     python download_avaturn.py --url "https://api.avaturn.me/avatars/exports/..."
     
  2. Developer API Token + Avatar ID export download:
     python download_avaturn.py --token "your_token" --avatar "avatar_id"
"""

import os
import sys
import argparse
import urllib.request
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET_PATH = ROOT / "avatar.glb"

def check_glb_morph_targets(file_path: Path) -> bool:
    """Analyze the downloaded glb to verify if it contains morph targets for lipsync."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(12)
            magic, version, length = struct.unpack("<4sII", header)
            if magic != b"glTF":
                return False
                
            chunk_header = f.read(8)
            chunk_length, chunk_type = struct.unpack("<II", chunk_header)
            if chunk_type != 0x4E4F534A: # JSON chunk
                return False
                
            json_data = f.read(chunk_length)
            data = json.loads(json_data.decode("utf-8", errors="ignore"))
            
            # Substring search for target indicators
            raw_str = json.dumps(data).lower()
            if "targets" in raw_str and "jawopen" in raw_str:
                print("✓ VERIFIED: Model has math morph targets (targets) and ARKit blendshapes (jawOpen) for lipsync!")
                return True
            else:
                print("⚠️  WARNING: Model successfully downloaded, but lacks morph targets ('targets' or 'jawOpen'). Lipsync will not work.")
                return False
    except Exception as e:
        print(f"Error validating GLB structure: {e}")
        return False

def download_url(url: str, output_path: Path):
    """Download a file from an HTTP URL."""
    print(f"Connecting to {url}...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    req = urllib.request.Request(url, headers=headers)
    
    with urllib.request.urlopen(req) as response:
        total_size = int(response.info().get('Content-Length', 0))
        downloaded = 0
        block_size = 8192
        
        with open(output_path, "wb") as f:
            while True:
                buffer = response.read(block_size)
                if not buffer:
                    break
                f.write(buffer)
                downloaded += len(buffer)
                if total_size > 0:
                    percent = (downloaded / total_size) * 100
                    print(f"\rDownloading: {percent:.1f}% ({downloaded / (1024*1024):.2f} MB / {total_size / (1024*1024):.2f} MB)", end="", flush=True)
                else:
                    print(f"\rDownloading: {downloaded / (1024*1024):.2f} MB", end="", flush=True)
            print()
    print(f"Successfully saved to {output_path.resolve()}")

def export_via_api(token: str, avatar_id: str) -> str | None:
    """Connect to the Avaturn developer API to initiate an export and retrieve the GLB link."""
    print("Connecting to Avaturn developer API...")
    url = "https://api.avaturn.dev/exports/new"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "avatar_id": avatar_id,
        "export_type": "httpURL",
        "options": {
            "format": "glb",
            "blendshapes": "arkit"  # Explicitly request ARKit facial morph targets!
        }
    }
    
    try:
        req = urllib.request.Request(
            url, 
            data=json.dumps(payload).encode("utf-8"), 
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            download_url_link = res_data.get("url") or res_data.get("export", {}).get("url")
            if download_url_link:
                print("✓ Avaturn export successful! Download URL acquired.")
                return download_url_link
            else:
                print(f"Error: API response did not contain download URL. Response: {res_data}")
                return None
    except Exception as e:
        print(f"Avaturn API export connection failed: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Avaturn 3D Avatar Downloader & Lipsync Checker")
    parser.add_argument("--url", type=str, help="Direct HTTP URL to the .glb file")
    parser.add_argument("--token", type=str, help="Your Avaturn developer API Token")
    parser.add_argument("--avatar", type=str, help="Your customized Avatar ID")
    args = parser.parse_args()
    
    if args.url:
        print(f"Direct download requested from URL...")
        try:
            download_url(args.url, TARGET_PATH)
            check_glb_morph_targets(TARGET_PATH)
        except Exception as e:
            print(f"Download failed: {e}")
            sys.exit(1)
            
    elif args.token and args.avatar:
        print(f"Avaturn API export requested for Avatar ID: {args.avatar}...")
        glb_url = export_via_api(args.token, args.avatar)
        if glb_url:
            try:
                download_url(glb_url, TARGET_PATH)
                check_glb_morph_targets(TARGET_PATH)
            except Exception as e:
                print(f"Download failed: {e}")
                sys.exit(1)
        else:
            print("Failed to acquire export download URL from Avaturn API.")
            sys.exit(1)
            
    else:
        print("Error: You must provide either a direct --url OR both --token and --avatar.")
        parser.print_help()
        sys.exit(1)

if __name__ == "__main__":
    main()
