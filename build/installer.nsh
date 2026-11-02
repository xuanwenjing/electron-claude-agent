; 在 Mac 上打出来的旧卸载程序会报 integrity check failed（退出码 2）。
; 忽略卸载结果，继续覆盖安装。
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Old uninstaller failed (code $R0), continue install."
  ${endif}
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
