param(
    [Parameter(Mandatory = $true)][int]$AppProcessId,
    [ValidateSet('accept', 'cancel', 'close')][string]$Action = 'accept',
    [string]$FilePath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MoyeWindowCheck {
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendText(IntPtr window, uint message, IntPtr wParam, string text);
}
'@
if ($Action -eq 'close') {
    $window = (Get-Process -Id $AppProcessId).MainWindowHandle
    if ($window -eq [IntPtr]::Zero) { throw 'Application window not found.' }
    if (-not [MoyeWindowCheck]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
        throw 'Close message failed.'
    }
    return
}

$processCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId)
$dialogCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
$deadline = [DateTime]::UtcNow.AddSeconds(15)
$dialog = $null
while (-not $dialog -and [DateTime]::UtcNow -lt $deadline) {
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children, $processCondition)
    foreach ($window in $windows) {
        if ($window.Current.ClassName -eq '#32770') { $dialog = $window; break }
        $dialog = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $dialogCondition)
        if ($dialog) { break }
    }
    if (-not $dialog) { Start-Sleep -Milliseconds 100 }
}
if (-not $dialog) { throw 'Native file dialog not found.' }

if ($Action -eq 'accept') {
    if (-not $FilePath) { throw 'FilePath is required.' }
    # Save uses 1001, Open uses 1148; also match Edit to exclude the address toolbar.
    $editCondition = [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.OrCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001'),
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1148')),
        [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit'))
    $edit = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    if (-not $edit) { throw 'File-name input not found.' }
    $editHandle = [IntPtr]$edit.Current.NativeWindowHandle
    if ($editHandle -eq [IntPtr]::Zero) { throw 'File-name input has no window handle.' }
    [MoyeWindowCheck]::SendText($editHandle, 0x000C, [IntPtr]::Zero, $FilePath) | Out-Null
}

$buttonId = if ($Action -eq 'cancel') { '2' } else { '1' }
$buttonCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $buttonId),
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Button'))
$button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
if (-not $button) { throw 'Dialog confirmation button not found.' }
$buttonHandle = [IntPtr]$button.Current.NativeWindowHandle
if ($buttonHandle -eq [IntPtr]::Zero) { throw 'Dialog button has no window handle.' }
if (-not [MoyeWindowCheck]::PostMessage($buttonHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) {
    throw 'Dialog button click failed.'
}
