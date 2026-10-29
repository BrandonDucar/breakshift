function Get-DemoTempo([double]$Duration, [double]$Slot) {
  if ([double]::IsNaN($Duration) -or [double]::IsInfinity($Duration) -or $Duration -le 0 -or
      [double]::IsNaN($Slot) -or [double]::IsInfinity($Slot) -or $Slot -le 0) { throw 'DEMO_INVALID_NARRATION_DURATION' }
  return [Math]::Max([double]1, $Duration / $Slot)
}

function Get-DemoWordMark($Marks, [int]$Position) {
  $matches = @($Marks | Where-Object { $_.Position -le $Position })
  if ($matches.Count -eq 0) { throw 'DEMO_WORD_MARK_MISSING' }
  return $matches[-1]
}
