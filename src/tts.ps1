# Convierte texto en voz con las voces de Windows (gratis, sin internet) y guarda un WAV.
# Uso: powershell -File tts.ps1 -Entrada texto.txt -Salida audio.wav [-Voz Raul] [-Velocidad 1.05]
param(
  [Parameter(Mandatory = $true)][string]$Entrada,
  [Parameter(Mandatory = $true)][string]$Salida,
  [string]$Voz = 'Raul',
  [double]$Velocidad = 1.05
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Esperar($operacion, [Type]$tipo) {
  $tarea = $asTask.MakeGenericMethod($tipo).Invoke($null, @($operacion))
  $tarea.Wait(-1) | Out-Null
  $tarea.Result
}

$texto = [System.IO.File]::ReadAllText($Entrada, [System.Text.Encoding]::UTF8)
$sintetizador = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voces = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
$elegida = $voces | Where-Object { $_.DisplayName -like "*$Voz*" } | Select-Object -First 1
if (-not $elegida) { $elegida = $voces | Where-Object { $_.Language -like 'es*' } | Select-Object -First 1 }
if ($elegida) { $sintetizador.Voice = $elegida }
try { $sintetizador.Options.SpeakingRate = $Velocidad } catch { }

$flujo = Esperar ($sintetizador.SynthesizeTextToStreamAsync($texto)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$lector = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($flujo)
$archivo = [System.IO.File]::Create($Salida)
try { $lector.CopyTo($archivo) } finally { $archivo.Close(); $lector.Close() }
Write-Output $elegida.DisplayName
