$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$slides = 1..6 | ForEach-Object {
    Get-ChildItem (Join-Path $root 'promo\xhs') -Filter ("{0:D2}-*.png" -f $_) | Select-Object -First 1
}

if ($slides.Count -ne 6 -or $slides -contains $null) {
    throw 'Run python scripts/build_assets.py before building the video.'
}

$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$output = Join-Path $root 'promo\xiaohongshu-demo.mp4'
$args = @('-y')
foreach ($slide in $slides) {
    $args += @('-loop', '1', '-t', '3', '-i', $slide.FullName)
}

$filter = @'
[0:v]scale=1080:1440,setsar=1,fps=30,format=yuv420p[v0];
[1:v]scale=1080:1440,setsar=1,fps=30,format=yuv420p[v1];
[2:v]scale=1080:1440,setsar=1,fps=30,format=yuv420p[v2];
[3:v]scale=1080:1440,setsar=1,fps=30,format=yuv420p[v3];
[4:v]scale=1080:1440,setsar=1,fps=30,format=yuv420p[v4];
[5:v]scale=1080:1440,setsar=1,fps=30,format=yuv420p[v5];
[v0][v1]xfade=transition=fade:duration=0.5:offset=2.5[x1];
[x1][v2]xfade=transition=fade:duration=0.5:offset=5.0[x2];
[x2][v3]xfade=transition=fade:duration=0.5:offset=7.5[x3];
[x3][v4]xfade=transition=fade:duration=0.5:offset=10.0[x4];
[x4][v5]xfade=transition=fade:duration=0.5:offset=12.5[outv]
'@ -replace "`r?`n", ''

$args += @(
    '-filter_complex', $filter,
    '-map', '[outv]',
    '-t', '15.5',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    $output
)

& $ffmpeg @args
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }
Write-Output $output
