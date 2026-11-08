/**
 * Builds a standalone Windows Desktop Executable (MEP-FieldHub-Windows.exe)
 * Embeds the compiled web assets (dist/) and bundled production server into a
 * single native Windows GUI executable (.exe) using the Windows .NET compiler (csc.exe).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const outExe = path.join(distDir, 'MEP-FieldHub-Windows.exe');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('Error: dist/index.html not found. Run "npm run build" first.');
  process.exit(1);
}

console.log('1. Bundling self-contained server (dist/server-standalone.cjs)...');
const esbuildBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
const bundleRes = spawnSync(
  esbuildBin,
  [
    'server.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:fsevents',
    '--external:vite',
    '--external:@vitejs/*',
    '--external:@tailwindcss/*',
    '--external:lightningcss',
    '--outfile=dist/server-standalone.cjs',
  ],
  { cwd: rootDir, stdio: 'inherit', shell: process.platform === 'win32' }
);

if (bundleRes.status !== 0) {
  console.warn('Warning: Standalone bundle fallback to dist/server.cjs');
  fs.copyFileSync(path.join(distDir, 'server.cjs'), path.join(distDir, 'server-standalone.cjs'));
}

// Create a single compressed archive (dist/app-bundle.json.gz) containing dist/ files needed at runtime
console.log('2. Packaging production assets into embedded payload...');
function collectFiles(dir, base = '') {
  const entries = {};
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.endsWith('.exe') || item.name.endsWith('.map') || item.name === 'app-bundle.gz') continue;
    const fullPath = path.join(dir, item.name);
    const relPath = base ? `${base}/${item.name}` : item.name;
    if (item.isDirectory()) {
      Object.assign(entries, collectFiles(fullPath, relPath));
    } else {
      entries[relPath] = fs.readFileSync(fullPath).toString('base64');
    }
  }
  return entries;
}

const payloadMap = collectFiles(distDir, 'dist');
const payloadJson = JSON.stringify({
  version: require(path.join(rootDir, 'package.json')).version || '1.5.0',
  buildTime: new Date().toISOString(),
  files: payloadMap,
});
const payloadGzPath = path.join(distDir, 'app-bundle.gz');
fs.writeFileSync(payloadGzPath, zlib.gzipSync(Buffer.from(payloadJson, 'utf-8')));

console.log('3. Compiling native Windows Desktop executable (MEP-FieldHub-Windows.exe)...');
const csSourcePath = path.join(distDir, 'MepFieldHubLauncher.cs');
const csCode = `
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Windows.Forms;

namespace MepFieldHub
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string appUrl = "http://127.0.0.1:3000";
            string workDir = AppDomain.CurrentDomain.BaseDirectory;

            // If running from a folder that already has dist/server.cjs (e.g., workspace root or extracted folder), use it;
            // otherwise extract embedded payload to %LOCALAPPDATA%\\MEP-FieldHub
            string serverScript = Path.Combine(workDir, "dist", "server-standalone.cjs");
            if (!File.Exists(serverScript))
            {
                string parentDir = Path.GetFullPath(Path.Combine(workDir, ".."));
                if (File.Exists(Path.Combine(parentDir, "dist", "server-standalone.cjs")))
                {
                    workDir = parentDir;
                    serverScript = Path.Combine(workDir, "dist", "server-standalone.cjs");
                }
                else
                {
                    workDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MEP-FieldHub");
                    Directory.CreateDirectory(workDir);
                    ExtractEmbeddedPayload(workDir);
                    serverScript = Path.Combine(workDir, "dist", "server-standalone.cjs");
                }
            }

            Process serverProc = null;
            if (!IsServerHealthy(appUrl + "/api/health"))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = "node";
                    psi.Arguments = "\\"" + serverScript + "\\"";
                    psi.WorkingDirectory = workDir;
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.EnvironmentVariables["NODE_ENV"] = "production";
                    psi.EnvironmentVariables["PORT"] = "3000";
                    serverProc = Process.Start(psi);

                    for (int i = 0; i < 25; i++)
                    {
                        if (IsServerHealthy(appUrl + "/api/health")) break;
                        Thread.Sleep(400);
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "Failed to start MEP FieldHub background server. Ensure Node.js 22+ is installed and on PATH.\\n\\nDetails: " + ex.Message,
                        "MEP FieldHub Enterprise ERP",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }
            }

            LaunchDesktopWindow(appUrl);
        }

        static bool IsServerHealthy(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 800;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        static void ExtractEmbeddedPayload(string targetRoot)
        {
            try
            {
                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream raw = asm.GetManifestResourceStream("app-bundle.gz"))
                {
                    if (raw == null) return;
                    using (GZipStream gz = new GZipStream(raw, CompressionMode.Decompress))
                    using (StreamReader sr = new StreamReader(gz, Encoding.UTF8))
                    {
                        string json = sr.ReadToEnd();
                        JavaScriptSerializer ser = new JavaScriptSerializer();
                        ser.MaxJsonLength = int.MaxValue;
                        var root = ser.Deserialize<Dictionary<string, object>>(json);
                        if (root != null && root.ContainsKey("files"))
                        {
                            var files = root["files"] as Dictionary<string, object>;
                            if (files != null)
                            {
                                foreach (var kv in files)
                                {
                                    string outPath = Path.Combine(targetRoot, kv.Key.Replace("/", "\\\\"));
                                    string outDir = Path.GetDirectoryName(outPath);
                                    if (!string.IsNullOrEmpty(outDir)) Directory.CreateDirectory(outDir);
                                    byte[] bytes = Convert.FromBase64String(kv.Value.ToString());
                                    File.WriteAllBytes(outPath, bytes);
                                }
                            }
                        }
                    }
                }
            }
            catch
            {
            }
        }

        static void LaunchDesktopWindow(string url)
        {
            string[] edgePaths = new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\\Edge\\Application\\msedge.exe")
            };
            foreach (string edge in edgePaths)
            {
                if (File.Exists(edge))
                {
                    Process.Start(new ProcessStartInfo(edge, "--app=" + url + " --window-size=1440,900") { UseShellExecute = true });
                    return;
                }
            }
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
    }
}
`;

fs.writeFileSync(csSourcePath, csCode, 'utf-8');

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];
const cscPath = cscCandidates.find(p => fs.existsSync(p));

if (!cscPath) {
  console.error('Error: Windows C# compiler (csc.exe) not found.');
  process.exit(1);
}

const compileRes = spawnSync(
  cscPath,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${outExe}`,
    `/resource:${payloadGzPath},app-bundle.gz`,
    '/reference:System.Web.Extensions.dll',
    '/reference:System.Windows.Forms.dll',
    csSourcePath,
  ],
  { cwd: rootDir, stdio: 'inherit' }
);

try {
  fs.unlinkSync(csSourcePath);
  fs.unlinkSync(payloadGzPath);
} catch {}

if (compileRes.status !== 0 || !fs.existsSync(outExe)) {
  console.error('Failed to compile MEP-FieldHub-Windows.exe');
  process.exit(1);
}

const sizeMb = (fs.statSync(outExe).size / (1024 * 1024)).toFixed(2);
console.log(`✓ Successfully built dist/MEP-FieldHub-Windows.exe (${sizeMb} MB)`);
