; Novel Downloader Installer Script
; Inno Setup Script - https://jrsoftware.org/isinfo.php

#define MyAppName "Novel Downloader"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Novel Downloader"
#define MyAppURL "https://github.com/noveldownloader"
#define MyAppExeName "NovelDownloader.exe"

[Setup]
; Unique App ID - DO NOT CHANGE after first release (used for updates)
AppId={{8F3B9A7C-5D2E-4F1A-B8C9-3E7D6A5F4B2C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
; Allow installing without admin (installs to user's AppData)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; Output settings
OutputDir=dist
OutputBaseFilename=NovelDownloader-Setup-{#MyAppVersion}
; SetupIconFile=assets\icon.ico  ; Uncomment if you have an icon
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Update behavior
UsePreviousAppDir=yes
; Uninstall settings
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "addtopath"; Description: "Add to PATH (run 'noveldownloader' from command line)"; GroupDescription: "System Integration:"; Flags: checkedonce

[Files]
Source: "dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "sources\*"; DestDir: "{app}\sources"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
// Pascal Script for PATH manipulation

procedure AddToPath(Path: string);
var
  Paths: string;
  PathType: Integer;
begin
  // Determine if admin install or user install
  if IsAdminInstallMode() then
    PathType := HKEY_LOCAL_MACHINE
  else
    PathType := HKEY_CURRENT_USER;

  // Get current PATH
  if not RegQueryStringValue(PathType, 'Environment', 'Path', Paths) then
    Paths := '';

  // Check if already in PATH
  if Pos(Uppercase(Path), Uppercase(Paths)) > 0 then
    Exit;

  // Add to PATH
  if Paths <> '' then
    Paths := Paths + ';' + Path
  else
    Paths := Path;

  // Save new PATH
  RegWriteStringValue(PathType, 'Environment', 'Path', Paths);

  // Notify system of environment change
  // This broadcasts WM_SETTINGCHANGE so running apps can see the update
end;

procedure RemoveFromPath(Path: string);
var
  Paths: string;
  PathType: Integer;
  P: Integer;
begin
  if IsAdminInstallMode() then
    PathType := HKEY_LOCAL_MACHINE
  else
    PathType := HKEY_CURRENT_USER;

  if not RegQueryStringValue(PathType, 'Environment', 'Path', Paths) then
    Exit;

  // Find and remove the path
  P := Pos(';' + Uppercase(Path), Uppercase(Paths));
  if P > 0 then
  begin
    Delete(Paths, P, Length(Path) + 1);
    RegWriteStringValue(PathType, 'Environment', 'Path', Paths);
    Exit;
  end;

  P := Pos(Uppercase(Path) + ';', Uppercase(Paths));
  if P > 0 then
  begin
    Delete(Paths, P, Length(Path) + 1);
    RegWriteStringValue(PathType, 'Environment', 'Path', Paths);
    Exit;
  end;

  // Path might be the only entry
  if Uppercase(Paths) = Uppercase(Path) then
  begin
    RegWriteStringValue(PathType, 'Environment', 'Path', '');
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if WizardIsTaskSelected('addtopath') then
      AddToPath(ExpandConstant('{app}'));
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    RemoveFromPath(ExpandConstant('{app}'));
  end;
end;

// Check for running instances before install/uninstall
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  // Try to delete the exe to check if it's running
  if FileExists(ExpandConstant('{app}\{#MyAppExeName}')) then
  begin
    if not DeleteFile(ExpandConstant('{app}\{#MyAppExeName}')) then
    begin
      Result := 'Novel Downloader is currently running. Please close it and try again.';
    end;
  end;
end;
