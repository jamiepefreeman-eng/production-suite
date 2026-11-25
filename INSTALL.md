# Installing Production Suite

Download the newest installer from the project's **GitHub → Releases** page,
under "Assets". You don't need any other software.

## Mac (Apple Silicon or Intel, macOS 10.15 or newer)
1. Download the file ending in **.dmg** and double-click it.
2. Drag **Production Suite** into **Applications**.
3. The first time you open it, macOS says it "can't verify" the app.
   That's because the app isn't registered with Apple yet (see the note at the bottom). Click **Done**, then:
   * Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to Production Suite.
   * Enter your password, then click **Open**. After that it opens normally.

**Video inputs (capture cards / cameras):** the first time you add one, macOS asks
“Production Suite would like to access the camera” — click **Allow**. If you clicked
Don't Allow, turn it on in **System Settings → Privacy & Security → Camera**.

## Windows 10 / 11
1. Download the file ending in **-setup.exe** and run it.
2. If a blue "Windows protected your PC" box appears, click **More info → Run anyway**.
3. Click through the installer. Production Suite appears in the Start menu.

## Updating
Download the newer installer and install it over the old one. Your show files are kept.

---
**About those warnings:** they appear because the app isn't code-signed yet.
Removing them costs money: an Apple Developer account is US$99 a year, and a
Windows signing certificate is roughly US$100–400 a year, or less through
Azure Trusted Signing. Once you have those, the build can sign the installers
automatically, and both warnings go away.
