# =====================================================================
# getdoodles.ps1 - run this once. It downloads a sample of real doodles from Google's
# "Quick, Draw!" dataset (free to use, CC BY 4.0) and saves them as doodles.js next to
# this script, for LittleSketch's Guess mode. It only reads the start of each big file,
# so it stays fairly quick. Run it again any time to get a fresh mix.
# =====================================================================

$PerWord   = 20      # doodles kept for each word
$MaxLines  = 300     # how far into each file to look before moving on to the next word
$MaxPoints = 250     # skip very detailed doodles, to keep doodles.js small
$Skip = @('line', 'squiggle', 'zigzag', 'circle', 'square', 'triangle', 'hexagon', 'octagon',
          'animal migration', 'camouflage', 'The Great Wall of China')   # too hard to guess from a doodle

$ListUrl = 'https://raw.githubusercontent.com/googlecreativelab/quickdraw-dataset/master/categories.txt'
$DataUrl = 'https://storage.googleapis.com/quickdraw_dataset/full/simplified/'

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$out = Join-Path $here 'doodles.js'

Write-Host 'Getting the word list...'
try {
  $listText = (New-Object System.Net.WebClient).DownloadString($ListUrl)
} catch {
  Write-Host ('Could not get the word list: ' + $_.Exception.Message)
  Read-Host 'Press Enter to close'
  exit
}
$cats = @($listText -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and ($Skip -notcontains $_) })
Write-Host ('{0} words to fetch. This takes a few minutes...' -f $cats.Count)

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('// doodles.js - real doodles from Google''s "Quick, Draw!" dataset (CC BY 4.0), made by getdoodles.ps1')
[void]$sb.AppendLine('// Each doodle is its strokes separated by spaces; each point is 4 hex digits (x then y, 0 to 255).')
[void]$sb.Append('export const DOODLES = {')
$n = 0; $words = 0; $total = 0

foreach ($cat in $cats) {
  $n++
  $word = ($cat -replace '^The ', '').ToLower()
  $kept = New-Object System.Collections.Generic.List[string]
  $req = $null
  try {
    $req = [System.Net.HttpWebRequest]::Create($DataUrl + [Uri]::EscapeDataString($cat) + '.ndjson')
    $req.Timeout = 30000
    $res = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($res.GetResponseStream())
    $lines = 0
    while ($kept.Count -lt $PerWord -and $lines -lt $MaxLines) {
      $line = $reader.ReadLine()
      if ($null -eq $line) { break }
      $lines++
      $d = $line | ConvertFrom-Json
      if (-not $d.recognized) { continue }   # only doodles Google's game could guess
      $points = 0
      $strokes = New-Object System.Collections.Generic.List[string]
      foreach ($s in $d.drawing) {
        $xs = @($s[0]); $ys = @($s[1])
        $p = New-Object System.Text.StringBuilder
        for ($i = 0; $i -lt $xs.Count; $i++) { [void]$p.Append(('{0:x2}{1:x2}' -f [int]$xs[$i], [int]$ys[$i])) }
        $points += $xs.Count
        if ($p.Length) { $strokes.Add($p.ToString()) }
      }
      if ($strokes.Count -eq 0 -or $points -gt $MaxPoints) { continue }
      $kept.Add('"' + ($strokes -join ' ') + '"')
    }
    $req.Abort()   # stop downloading the rest of the big file
  } catch {
    if ($req) { try { $req.Abort() } catch {} }
    Write-Host ('  skipped {0}: {1}' -f $cat, $_.Exception.Message)
    continue
  }
  if ($kept.Count -eq 0) { Write-Host ('  skipped {0}: no good doodles' -f $cat); continue }
  if ($words -gt 0) { [void]$sb.Append(',') }
  [void]$sb.Append("`n" + '"' + $word + '":[' + ($kept -join ',') + ']')
  $words++; $total += $kept.Count
  Write-Host ('{0}/{1}  {2}: {3}' -f $n, $cats.Count, $word, $kept.Count)
}

[void]$sb.Append("`n};`n")
[System.IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
$mb = (Get-Item $out).Length / 1MB
Write-Host ''
Write-Host ('Done! {0} words, {1} doodles, saved to doodles.js ({2:N1} MB)' -f $words, $total, $mb)
Read-Host 'Press Enter to close'