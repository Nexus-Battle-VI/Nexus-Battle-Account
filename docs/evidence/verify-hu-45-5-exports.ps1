$ErrorActionPreference = 'Stop'
$evidenceDirectory = Join-Path $PSScriptRoot '../../.tmp/hu-45-5'

foreach ($holder in @('ana', 'beatriz')) {
    $json = Get-Content -LiteralPath (Join-Path $evidenceDirectory "$holder.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $xmlPath = [System.IO.Path]::GetFullPath((Join-Path $evidenceDirectory "$holder.xml"))
    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create($xmlPath, $settings)
    try {
        $xml = [System.Xml.XmlDocument]::new()
        $xml.XmlResolver = $null
        $xml.Load($reader)
    } finally {
        $reader.Dispose()
    }

    if ($xml.DocumentElement.Name -cne 'privacyExport') { throw 'Raiz XML incorrecta.' }
    if ($xml.privacyExport.schemaVersion -cne $json.schemaVersion) { throw 'Version diferente.' }
    if ($xml.privacyExport.generatedAt -cne $json.generatedAt) { throw 'Fecha diferente.' }
    if ($json.personalData.email -cne "$holder@nexus.test") { throw 'Titular incorrecto.' }
    $expectedFields = @('displayName', 'email', 'firstNames', 'lastNames', 'roles', 'termsAccepted')
    $jsonFields = @($json.personalData.PSObject.Properties.Name | Sort-Object)
    $xmlFields = @($xml.privacyExport.personalData.ChildNodes | ForEach-Object { $_.Name } | Sort-Object)
    if (($jsonFields -join ',') -cne ($expectedFields -join ',')) { throw 'Campos JSON inesperados.' }
    if (($xmlFields -join ',') -cne ($expectedFields -join ',')) { throw 'Campos XML inesperados.' }
    foreach ($field in @('email', 'displayName', 'firstNames', 'lastNames')) {
        if ($xml.privacyExport.personalData.$field -cne $json.personalData.$field) { throw "Semantica diferente: $field." }
    }
    if ($xml.privacyExport.personalData.termsAccepted -cne $json.personalData.termsAccepted.ToString().ToLowerInvariant()) {
        throw 'Consentimiento diferente.'
    }
    $xmlRoles = @($xml.privacyExport.personalData.roles.role)
    if (($xmlRoles -join ',') -cne ($json.personalData.roles -join ',')) { throw 'Roles diferentes.' }
    Write-Output "PASS $holder : JSON parseable, XML bien formado, titular y semantica equivalentes."
}
