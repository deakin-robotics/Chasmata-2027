param(
  [string]$ApiUrl = 'http://localhost:9997'
)

$expectedPaths = @('front', 'gimbal', 'arm')
$response = Invoke-RestMethod -Uri "$ApiUrl/v3/paths/list" -Method Get

foreach ($pathName in $expectedPaths) {
  $path = @($response.items | Where-Object { $_.name -eq $pathName })
  if ($path.Count -ne 1) {
    throw "MediaMTX did not expose the expected path '$pathName'."
  }

  if (-not $path[0].ready) {
    throw "MediaMTX path '$pathName' is configured but not receiving a source."
  }
}

Write-Output "MediaMTX reports ready sources for: $($expectedPaths -join ', ')"
