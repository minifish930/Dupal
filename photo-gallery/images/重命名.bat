@echo off
setlocal enabledelayedexpansion
set count=1
for %%a in (*.jpg) do (
    set /a num=1000+count
    if !num:~1!==000 (
    set /a count+=1
    set /a num=1000+count
    )
   ren "%%a" "photo!num:~1!.jpg"
    set /a count+=1
)
