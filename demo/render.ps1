param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$OutputPath = (Resolve-Path -LiteralPath $OutputPath).Path
$story = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'story.json') -Raw | ConvertFrom-Json
$receipt = Get-Content -LiteralPath (Join-Path $OutputPath 'capture-receipt.json') -Raw | ConvertFrom-Json
if (-not $receipt.passed -or -not $receipt.recording) { throw 'A passing recorded capture is required' }
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.Rate = 0
$voice.SelectVoice('Microsoft Zira Desktop')
$inputs = @('-y', '-ss', [string]$receipt.startVideoSeconds, '-i', $receipt.rawVideoPath)
$filters = @()
$channels = @()
$srt = New-Object System.Collections.Generic.List[string]
$index = 1
function CueTime([double]$seconds) { return ([TimeSpan]::FromSeconds($seconds)).ToString('hh\:mm\:ss\,fff') }
try {
  foreach ($shot in $story.shots) {
    $wav = Join-Path $OutputPath ($shot.id + '.wav')
    $voice.SetOutputToWaveFile($wav)
    $voice.Speak($shot.narration)
    $voice.SetOutputToNull()
    $duration = [double](& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $wav)
    if ($LASTEXITCODE -ne 0) { throw 'Audio duration probe failed' }
    $slot = [double]$shot.end - [double]$shot.start - 0.4
    $rate = [Math]::Max(1, $duration / $slot)
    if ($rate -gt 1.3) { throw ('Narration too dense: ' + $shot.id) }
    $rateText = $rate.ToString('0.000000',[Globalization.CultureInfo]::InvariantCulture)
    $delay = [int]([double]$shot.start * 1000)
    $inputs += @('-i', $wav)
    $filters += ('[{0}:a]atempo={1},adelay={2}|{2}[a{0}]' -f $index,$rateText,$delay)
    $channels += ('[a{0}]' -f $index)
    $words = $shot.narration.Split(' ',[StringSplitOptions]::RemoveEmptyEntries)
    $groups = [int][Math]::Ceiling($words.Length / 14.0)
    for ($g=0; $g -lt $groups; $g++) {
      $from = [double]$shot.start + ($slot / $groups * $g)
      $to = [double]$shot.start + ($slot / $groups * ($g+1))
      $last = [Math]::Min($words.Length-1, ($g+1)*14-1)
      $srt.Add([string]($srt.Count/4+1))
      $srt.Add((CueTime $from) + ' --> ' + (CueTime $to))
      $srt.Add(($words[($g*14)..$last] -join ' '))
      $srt.Add('')
    }
    $index++
  }
} finally { $voice.Dispose() }
[IO.File]::WriteAllLines((Join-Path $OutputPath 'demo.srt'),$srt,[Text.UTF8Encoding]::new($false))
$filters += (($channels -join '') + ('amix=inputs={0}:normalize=0,apad,atrim=duration={1},alimiter=limit=0.95[audio]' -f $story.shots.Count,$story.durationSeconds))
$filters += "[0:v]fps=30,subtitles=demo.srt:force_style='FontName=Arial,FontSize=20,Outline=2,MarginV=18',drawtext=text='LOCAL REPLAY | RECORDED META OUTPUTS | SIMULATION':fontcolor=white:fontsize=18:box=1:boxcolor=black@0.7:x=18:y=12[video]"
Push-Location -LiteralPath $OutputPath
try {
  & ffmpeg @inputs -filter_complex ($filters -join ';') -map '[video]' -map '[audio]' -t $story.durationSeconds -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart 'breakshift-demo-draft.mp4'
  if ($LASTEXITCODE -ne 0) { throw 'Demo encoding failed' }
  & ffprobe -v error -show_entries format=duration,size:stream=codec_type,width,height -of json 'breakshift-demo-draft.mp4'
  if ($LASTEXITCODE -ne 0) { throw 'Final media probe failed' }
} finally { Pop-Location }
