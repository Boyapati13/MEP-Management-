param(
    [int]$Port = 8000,
    [string]$Root = (Get-Location).Path
)

# Simple static file server using HttpListener. Defaults to serving
# `web_avatar/index.html` for root requests to make previewing easier.

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Serving $Root on http://localhost:$Port/"

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $urlPath = [System.Web.HttpUtility]::UrlDecode($req.Url.AbsolutePath)
        if ([string]::IsNullOrEmpty($urlPath) -or $urlPath -eq '/') { $urlPath = '/web_avatar/index.html' }

        $localPath = Join-Path $Root ($urlPath.TrimStart('/'))
        if (-not (Test-Path $localPath)) {
            $res.StatusCode = 404
            $msg = "404 Not Found"
            $buf = [System.Text.Encoding]::UTF8.GetBytes($msg)
            $res.ContentLength64 = $buf.Length
            $res.OutputStream.Write($buf,0,$buf.Length)
            $res.Close()
            continue
        }

        $bytes = [System.IO.File]::ReadAllBytes($localPath)
        switch ([System.IO.Path]::GetExtension($localPath).ToLower()) {
            '.html' { $ct = 'text/html' }
            '.htm'  { $ct = 'text/html' }
            '.js'   { $ct = 'application/javascript' }
            '.css'  { $ct = 'text/css' }
            '.png'  { $ct = 'image/png' }
            '.jpg'  { $ct = 'image/jpeg' }
            '.jpeg' { $ct = 'image/jpeg' }
            '.gif'  { $ct = 'image/gif' }
            '.svg'  { $ct = 'image/svg+xml' }
            '.glb'  { $ct = 'model/gltf-binary' }
            '.json' { $ct = 'application/json' }
            default { $ct = 'application/octet-stream' }
        }

        $res.ContentType = $ct
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes,0,$bytes.Length)
        $res.Close()
    } catch {
        Write-Host "Error: $_"
    }
}
