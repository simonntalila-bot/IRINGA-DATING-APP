@echo off
REM Built from a short path: the project path on the Desktop exceeds the
REM Windows 260-character limit that ninja enforces when building C++.
REM This is a build-only copy - edit the real project on the Desktop.
set GRADLE_USER_HOME=D:\gradle-home
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set ANDROID_SDK_ROOT=%ANDROID_HOME%
cd /d "D:\ir\mobile\android"
call gradlew.bat assembleRelease --no-daemon
echo GRADLE_EXIT=%ERRORLEVEL%