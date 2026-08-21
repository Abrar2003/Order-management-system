$ErrorActionPreference = 'Stop'
$sourcePath = 'D:\dev\repos\oms\.tmp\oms-labels-reference.md'
$flowPath = 'D:\dev\repos\oms\.tmp\oms-label-lifecycle-flow.png'
$outputPath = 'D:\dev\repos\oms\docs\OMS_Labels_Lifecycle_Reference.docx'
$word = $null
$doc = $null

function Get-WordColor([int]$r, [int]$g, [int]$b) {
  return $r + (256 * $g) + (65536 * $b)
}

$navy = Get-WordColor 11 37 69
$blue = Get-WordColor 46 116 181
$muted = Get-WordColor 89 96 105
$gold = Get-WordColor 122 90 0
$callout = Get-WordColor 244 246 249
$wdAlignLeft = 0
$wdAlignCenter = 1
$wdPageBreak = 7

function Add-Para {
  param(
    [string]$Text,
    [double]$Size = 10.7,
    [int]$Color = 0,
    [bool]$Bold = $false,
    [bool]$Italic = $false,
    [int]$Align = 0,
    [double]$Before = 0,
    [double]$After = 6,
    [double]$Line = 15
  )

  $start = $doc.Content.End - 1
  $insert = $doc.Range($start, $start)
  $insert.Text = $Text + [char]13
  $range = $doc.Range($start, $start + $Text.Length)
  $range.Font.Name = 'Calibri'
  $range.Font.Size = $Size
  $range.Font.Color = $Color
  $range.Font.Bold = [int]$Bold
  $range.Font.Italic = [int]$Italic
  $paragraph = $range.Paragraphs.Item(1)
  $paragraph.Alignment = $Align
  $paragraph.Format.SpaceBefore = $Before
  $paragraph.Format.SpaceAfter = $After
  $paragraph.Format.LineSpacingRule = 5
  $paragraph.Format.LineSpacing = $Line
  return $paragraph
}

function Add-Heading {
  param([string]$Text, [int]$Level)
  if ($Level -eq 1) {
    $p = Add-Para $Text 16 $blue $true $false $wdAlignLeft 18 10 15
  } else {
    $p = Add-Para $Text 13 $blue $true $false $wdAlignLeft 14 7 15
  }
  $p.Format.KeepWithNext = $true
}

function Add-Callout {
  param([string]$Text)
  $p = Add-Para $Text 10.3 $navy $false $true $wdAlignLeft 4 8 14
  $p.Range.Shading.BackgroundPatternColor = $callout
  $p.Range.ParagraphFormat.LeftIndent = 14
  $p.Range.ParagraphFormat.RightIndent = 14
}

function Add-Bullet {
  param([string]$Text, [int]$IndentLevel = 0)
  $p = Add-Para $Text 10.5 0 $false $false $wdAlignLeft 0 3 14
  $p.Range.ListFormat.ApplyBulletDefault()
  $p.Range.ParagraphFormat.LeftIndent = 27 + ($IndentLevel * 18)
  $p.Range.ParagraphFormat.FirstLineIndent = -13
}

try {
  if (!(Test-Path $sourcePath)) { throw "Missing content source: $sourcePath" }
  if (!(Test-Path $flowPath)) { throw "Missing flow chart: $flowPath" }

  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Add()
  $section = $doc.Sections.Item(1)
  $section.PageSetup.TopMargin = $word.InchesToPoints(1)
  $section.PageSetup.BottomMargin = $word.InchesToPoints(1)
  $section.PageSetup.LeftMargin = $word.InchesToPoints(1)
  $section.PageSetup.RightMargin = $word.InchesToPoints(1)
  $section.PageSetup.HeaderDistance = $word.InchesToPoints(0.492)
  $section.PageSetup.FooterDistance = $word.InchesToPoints(0.492)

  $header = $section.Headers.Item(1)
  $header.Range.Text = 'OMS | LABEL LIFECYCLE REFERENCE'
  $header.Range.Font.Name = 'Calibri'
  $header.Range.Font.Size = 8
  $header.Range.Font.Bold = -1
  $header.Range.Font.Color = $muted
  $header.Range.ParagraphFormat.Alignment = $wdAlignCenter

  $footer = $section.Footers.Item(1)
  $footer.Range.Text = 'Internal technical reference | Generated 21 August 2026'
  $footer.Range.Font.Name = 'Calibri'
  $footer.Range.Font.Size = 8
  $footer.Range.Font.Color = $muted
  $footer.Range.ParagraphFormat.Alignment = $wdAlignCenter

  $isFirstTitle = $true
  foreach ($line in Get-Content -LiteralPath $sourcePath) {
    $trimmed = $line.Trim()
    if (!$trimmed) { continue }

    if ($trimmed -eq '<<<FLOW CHART>>>') {
      $break = Add-Para '' 1 0 $false $false $wdAlignLeft 0 0 12
      $break.Range.InsertBreak($wdPageBreak)
      Add-Heading 'End-to-end flow chart' 1
      Add-Para 'The diagram separates the three label lifecycles. Subsequent sections provide the complete field, rule, API and consumer inventory.' 10.7 0 $false $false $wdAlignLeft 0 8 15 | Out-Null
      $pictureRange = $doc.Range($doc.Content.End - 1, $doc.Content.End - 1)
      $picture = $doc.InlineShapes.AddPicture($flowPath, $false, $true, $pictureRange)
      $picture.Width = $word.InchesToPoints(6.35)
      $picture.Height = $word.InchesToPoints(4.65)
      $doc.Range($doc.Content.End - 1, $doc.Content.End - 1).Text = [string][char]13
      Add-Para 'Figure 1. QC serial labels, barcode values, and artwork files have separate sources of truth and separate persistence paths.' 8.5 $muted $true $true $wdAlignCenter 2 10 11 | Out-Null
      continue
    }

    if ($trimmed -match '^# (.+)$') {
      if ($isFirstTitle) {
        Add-Para 'TECHNICAL REFERENCE • CODEBASE AUDIT' 10 $gold $true $false $wdAlignCenter 92 15 12 | Out-Null
        Add-Para $matches[1] 30 $navy $true $false $wdAlignCenter 0 8 32 | Out-Null
        $isFirstTitle = $false
      } else {
        Add-Heading $matches[1] 1
      }
      continue
    }

    if ($trimmed -match '^## (.+)$') {
      Add-Heading $matches[1] 1
      continue
    }

    if ($trimmed -match '^### (.+)$') {
      Add-Heading $matches[1] 2
      continue
    }

    if ($trimmed -match '^> (.+)$') {
      Add-Callout $matches[1]
      continue
    }

    if ($trimmed -match '^- (.+)$') {
      Add-Bullet $matches[1]
      continue
    }

    if ($trimmed -match '^\d+\. (.+)$') {
      $p = Add-Para $trimmed 10.5 0 $false $false $wdAlignLeft 0 3 14
      $p.Range.ListFormat.ApplyNumberDefault()
      continue
    }

    Add-Para $trimmed 10.7 0 $false $false $wdAlignLeft 0 6 15 | Out-Null
  }

  $doc.SaveAs2($outputPath, 16)
  "DOCX_CREATED=$outputPath"
} finally {
  if ($doc -ne $null) { $doc.Close() }
  if ($word -ne $null) { $word.Quit() }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
