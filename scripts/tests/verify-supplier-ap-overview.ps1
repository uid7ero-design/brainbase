$ErrorActionPreference = 'Stop'
$taskContainer = "brainbase-ap-overview-$PID"
$taskPort = 55448
$taskPreviousDatabaseUrl = $env:DATABASE_URL
try {
  docker run --name $taskContainer -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb -p "127.0.0.1:${taskPort}:5432" -d postgres:16-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL startup failed' }
  $taskReady = $false
  for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    docker exec $taskContainer pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { $taskReady = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $taskReady) { throw 'Disposable PostgreSQL did not become ready' }
  $env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:$taskPort/testdb"
  npx vitest run --config vitest.integration.config.ts scripts/tests/supplierApOverview.integration.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Supplier AP overview integration failed' }
} finally {
  $env:DATABASE_URL = $taskPreviousDatabaseUrl
  docker rm -f $taskContainer | Out-Null
}
