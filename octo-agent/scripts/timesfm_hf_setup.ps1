# TimesFM Forecaster Integration Guide
# =====================================
# Run these once to suppress the HuggingFace unauthenticated warning.
# (Optional — model works without it, this just enables higher rate limits)

# Option A: Set HF_TOKEN env variable (get free token at huggingface.co)
# $env:HF_TOKEN = "hf_YOUR_TOKEN_HERE"

# Option B: Use huggingface-cli login
# pip install huggingface_hub
# huggingface-cli login

# Option C: Set it permanently in PowerShell profile
# [System.Environment]::SetEnvironmentVariable("HF_TOKEN", "hf_...", "User")
