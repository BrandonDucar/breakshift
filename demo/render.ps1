param([Parameter(Mandatory=$true)][string]$OutputPath, [string]$RenderPath)
$ErrorActionPreference = 'Stop'
function FileDigest([string]$Path) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
$OutputPath = (Resolve-Path -LiteralPath $OutputPath).Path
$story = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'story.json') -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath (Join-Path $OutputPath 'capture-receipt.json') -Raw | ConvertFrom-Json
if (-not $receipt.passed -or -not $receipt.recording) { throw 'A passing recorded capture is required' }
if ((FileDigest (Join-Path $PSScriptRoot 'story.json')) -ne $receipt.storySha256) { throw 'CAPTURE_STORY_MISMATCH' }
$capturePath = $OutputPath
if ($RenderPath) {
  $target = [IO.Path]::GetFullPath($RenderPath)
  if (Test-Path -LiteralPath $target) { throw 'DEMO_RENDER_EVIDENCE_ALREADY_EXISTS' }
  New-Item -ItemType Directory -Path $target | Out-Null
  $OutputPath = $target
  foreach ($name in @('capture-receipt.json','offline-tests.tap','uncertainty-experiment.json','energy-comparison.json')) {
    Copy-Item -LiteralPath (Join-Path $capturePath $name) -Destination (Join-Path $OutputPath $name)
  }
}
$reserved = @('demo.srt','breakshift-demo-draft.mp4','media-verification.json','narration-timing.json','render-receipt.json','filter-graph.txt') + @($story.shots | ForEach-Object { $_.id + '.wav' })
foreach ($name in $reserved) {
  if (Test-Path -LiteralPath (Join-Path $OutputPath $name)) { throw ('DEMO_RENDER_EVIDENCE_ALREADY_EXISTS: ' + $name) }
}
Add-Type -AssemblyName System.Speech
Add-Type -Path (Join-Path $PSScriptRoot 'Narration.cs') -ReferencedAssemblies 'System.Speech'
$rawDuration = [double](& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $receipt.rawVideoPath)
if ($LASTEXITCODE -ne 0) { throw 'Raw video probe failed' }
# Browser recording begins on the first rendered frame, not newPage wall time.
$trim = [Math]::Max([double]0, $rawDuration - [double]$story.durationSeconds)
$inputs = @('-y', '-ss', $trim.ToString('0.000000',[Globalization.CultureInfo]::InvariantCulture), '-i', $receipt.rawVideoPath)
$filters = @()
$channels = @()
$srt = New-Object System.Collections.Generic.List[string]
$timings = @()
$index = 1
function CueTime([double]$seconds) { return ([TimeSpan]::FromSeconds($seconds)).ToString('hh\:mm\:ss\,fff') }
  foreach ($shot in $story.shots) {
    $wav = Join-Path $OutputPath ($shot.id + '.wav')
    $marks = [DemoNarration]::Synthesize($shot.narration, $wav)
    if ($marks.Count -lt 2) { throw ('Missing speech word timestamps: ' + $shot.id) }
    $duration = [double](& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $wav)
    if ($LASTEXITCODE -ne 0) { throw 'Audio duration probe failed' }
    $slot = [double]$shot.end - [double]$shot.start - 0.4
    # An integer first argument selects Math.Max(int,int), silently losing tempo.
    $rate = [Math]::Max([double]1, $duration / $slot)
    if ($rate -gt 1.3) { throw ('Narration too dense: ' + $shot.id) }
    $rateText = $rate.ToString('0.000000',[Globalization.CultureInfo]::InvariantCulture)
    $delay = [int]([double]$shot.start * 1000)
    $inputs += @('-i', $wav)
    $filters += ('[{0}:a]atempo={1},asetpts=PTS-STARTPTS,adelay={2}|{2}[a{0}]' -f $index,$rateText,$delay)
    $channels += ('[a{0}]' -f $index)
    $timings += [pscustomobject]@{shot=$shot.id; start=[double]$shot.start; end=[double]$shot.end; rawDuration=$duration; tempo=$rate; fittedDuration=$duration/$rate; wordMarks=$marks}
    $words = @([regex]::Matches($shot.narration, '\S+'))
    $groups = [int][Math]::Ceiling($words.Length / 14.0)
    for ($g=0; $g -lt $groups; $g++) {
      $first = $g*14
      $last = [Math]::Min($words.Length-1, ($g+1)*14-1)
      $mark = @($marks | Where-Object { $_.Position -le $words[$first].Index })[-1]
      $from = [double]$shot.start + $mark.Seconds/$rate
      $to = [double]$shot.start + $duration/$rate
      if ($last+1 -lt $words.Length) {
        $next = @($marks | Where-Object { $_.Position -le $words[$last+1].Index })[-1]
        $to = [double]$shot.start + $next.Seconds/$rate
      }
      if ($to -le $from -or $to -gt [double]$shot.end) { throw ('Invalid speech cue: {0} {1} -> {2}, words {3}, mark {4}' -f $shot.id,$from,$to,$words.Length,$mark.Position) }
      $srt.Add([string]($srt.Count/4+1))
      $srt.Add((CueTime $from) + ' --> ' + (CueTime $to))
      $srt.Add((@($words[$first..$last] | ForEach-Object { $_.Value }) -join ' '))
      $srt.Add('')
    }
    $index++
  }
[IO.File]::WriteAllLines((Join-Path $OutputPath 'demo.srt'),$srt,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $OutputPath 'narration-timing.json'),($timings | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$filters += (($channels -join '') + ('amix=inputs={0}:normalize=0,apad,atrim=duration={1},aresample=48000,alimiter=limit=0.95[audio]' -f $story.shots.Count,$story.durationSeconds))
$filters += "[0:v]fps=30,tpad=stop_mode=clone:stop_duration=1,subtitles=demo.srt:force_style='FontName=Arial,FontSize=12,Outline=1,MarginV=12',drawtext=text='LOCAL REPLAY | RECORDED META OUTPUTS | SIMULATION':fontcolor=white:fontsize=18:box=1:boxcolor=black@0.7:x=w-tw-18:y=12[video]"
[IO.File]::WriteAllText((Join-Path $OutputPath 'filter-graph.txt'),($filters -join ';'),[Text.UTF8Encoding]::new($false))
$pins = @()
foreach ($path in @($PSCommandPath,(Join-Path $PSScriptRoot 'Narration.cs'),(Join-Path $PSScriptRoot 'capture.mjs'),(Join-Path $PSScriptRoot 'story.json'),$receipt.rawVideoPath) + @($reserved | Where-Object { $_ -notin @('breakshift-demo-draft.mp4','media-verification.json','render-receipt.json') } | ForEach-Object { Join-Path $OutputPath $_ })) {
  $pins += [pscustomobject]@{path=$path; sha256=(FileDigest $path)}
}
Push-Location -LiteralPath $OutputPath
try {
  & ffmpeg @inputs -filter_complex ($filters -join ';') -map '[video]' -map '[audio]' -t $story.durationSeconds -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart 'breakshift-demo-draft.mp4'
  if ($LASTEXITCODE -ne 0) { throw 'Demo encoding failed' }
  & ffprobe -v error -show_entries format=duration,size:stream=codec_type,width,height -of json 'breakshift-demo-draft.mp4'
  if ($LASTEXITCODE -ne 0) { throw 'Final media probe failed' }
  $render = @{schema='breakshift.demo-render.v1';passed=$true;inputs=$pins;filterGraph=($filters -join ';');voice='Microsoft Zira Desktop';providerCalls=0;incrementalSpendUsd=0;outputSha256=(FileDigest (Join-Path $OutputPath 'breakshift-demo-draft.mp4'))}
  [IO.File]::WriteAllText((Join-Path $OutputPath 'render-receipt.json'),($render | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
} finally { Pop-Location }
