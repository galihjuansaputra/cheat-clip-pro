Option Explicit
Dim shell, fso, root, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
command = "cmd.exe /d /s /c """ & root & "\scripts\run-dev-hidden.bat"""
Dim pid, runtime, file
pid = shell.Run(command, 0, False)
runtime = root & "\.runtime"
If Not fso.FolderExists(runtime) Then fso.CreateFolder(runtime)
Set file = fso.CreateTextFile(runtime & "\dev.pid", True)
file.Write CStr(pid)
file.Close
