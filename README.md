# Two-Person Real-Time Chat App

A lightweight, real-time chat application designed for exactly two people. It is built using Node.js, Express, and Socket.IO.

---

## Guide for Windows Beginners

Follow these simple steps to set up and run the chat application on your Windows machine.

### Step 1: Install Node.js
Node.js is the environment needed to run the application code.
1. Open your web browser and go to the official Node.js website: [https://nodejs.org/](https://nodejs.org/)
2. Download and install the **LTS (Long Term Support)** version for Windows (recommended for most users).
3. Run the installer and accept the default options.

### Step 2: Open PowerShell
PowerShell is a command line terminal built into Windows.
1. Click the Windows Start Menu.
2. Type `PowerShell` and click on **Windows PowerShell**.

### Step 3: Navigate to the Project Folder
In PowerShell, navigate to the directory where this chat application is located. Run:
```powershell
cd "e:\SUMMER\CHAT APP\chat-app"
```
*(If your files are located in a different path, replace the path above with your folder's path.)*

### Step 4: Install Dependencies
Run the following command to download and install the required library dependencies (Express and Socket.IO):
```powershell
npm install
```
This will create a `node_modules` folder inside your directory containing the libraries.

### Step 5: Set the Access Code Environment Variable
To prevent unauthorized users from joining, the application requires a shared access code. You need to set the `ACCESS_CODE` environment variable in your PowerShell session before starting the server.

Set it by running:
```powershell
$env:ACCESS_CODE="letmein"
```
*(You can replace `"letmein"` with any password/passcode of your choice.)*

If you want to use a custom port (the default is 3000), you can also set:
```powershell
$env:PORT="3000"
```

### Step 6: Start the Server
Start the application server by running:
```powershell
npm start
```
You should see a message saying:
`Server listening on port 3000`

### Step 7: Open in a Web Browser
1. Open any web browser (Google Chrome, Microsoft Edge, Firefox, etc.).
2. Go to [http://localhost:3000](http://localhost:3000).
3. Enter your username and the access code you set in Step 5 (e.g., `letmein`) to join the chat.

---

## How to Deploy to Render

Render is a free cloud hosting service. To deploy your chat app so that it can be accessed from any device on the internet, follow these steps:

1. **Push to GitHub:**
   - Create a repository on GitHub.
   - Commit your code (excluding `node_modules/` via `.gitignore`) and push it to your GitHub repository.

2. **Create a Web Service on Render:**
   - Go to [https://render.com/](https://render.com/) and sign up / log in.
   - Click **New** → **Web Service**.
   - Connect your GitHub repository.

3. **Configure the Service:**
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - Select the **Free** instance type.

4. **Add Environment Variables:**
   - Under the **Environment** tab, click **Add Environment Variable**.
   - Key: `ACCESS_CODE`
   - Value: `[your-private-access-code]`
   - Click **Save Changes**.

5. **Accessing the App:**
   - Render will assign a public URL (e.g., `https://your-app-name.onrender.com`).
   - Share this link and the `ACCESS_CODE` with your partner.
   - *Note: On the free tier, Render spins down the service after 15 minutes of inactivity. When someone visits the URL next time, it may take 30-60 seconds to spin back up. This is normal behavior, and the UI will show "Reconnecting..." during this phase.*
