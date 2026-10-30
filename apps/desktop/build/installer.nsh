; Lets other devices on the network reach the game server: an inbound
; firewall rule for the app, added on install and removed on uninstall.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Terra en disputa"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Terra en disputa" dir=in action=allow protocol=TCP profile=private program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Terra en disputa"'
!macroend
