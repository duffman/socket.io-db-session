# socket.io-db-session
Socket.IO Database Powered Sessionv- based on https://bitbucket.org/jnbarlow/socket.io-mysql-session

Socket-io-mysql-session is a session manager for socket.io and websockets using MySQL as a session store.
This was
designed specifically for applications that use frameworks like PhoneGap, where cookies are unreliable after
the app is compiled.

This is designed as middleware for socket.io.  When a socket connects, it creates a new instance of itself and attaches
to socket.session.  From there, you can interact with the session on the server side.

# Default Events

By default, the middleware creates a "**getToken**" listener.  This listener waits for the client to send a "*getToken*" event
along with an object that contains a token.  It then tries to load the session.  However, if the session cannot be found
or is expired, it will create a new session.  After all of this is done, it will then emit a "**gotToken**" with an object
that contains a token (either a new one or the one you passed in), and any error messages encountered:

```javascript
{token: "foo", errors: ""}
```

# Usage - Server Side

To instantiate the session manager and add it to socket io:

### Example
```javascript
var socketSession = require("socket.io-mysql-session"),
    app = express(),
    http = require('http').Server(app),
    Logger = require("filelogger"),                   //filelogger is not required, but supported by the middleware
    logger = new Logger("error", "info", "my.log"),
    io = require("socket.io")(http),
    mysql = require("mysql"),
    options = {
        host: "localhost",
        port: 3306,
        user: "root",
        password: "root",
        database: "foo"
        },
     db = mysql.createConnection(options),

//add the middleware

io.use(new socketSession({
    db: db,           //MySQL conneciton - required
    logger: logger    //filelogger - optional
    expiration: 3600  //expiration time in seconds - optional - defaults to 86400000
}));

```

## Usage - Interaction with the session

To get and set items to the session scope, there are two handy functions included -- get and set.  Set will automatically
save the session to the database when called.

### API
Function     | Parameters | Description
--------     | ---------- | -----------
set          | key, value | Saves into the session at Key, Value -- persists to database, updates expires
get          | key        | Retrieves Key from the session. If it doesn't exist, returns ""
clearSession |            | Clears session data from the socket.

### Example
```javascript
io.on("connection", function(socket){
    socket.on("user:login", function(params){
        //do login stuff here with params
        var userId = "id from code above";
        socket.session.set("userId", userId);
    });

    socket.on("user:securedEvent", function(params){
        var userId = socket.session.get("userId");

        if(userId != ""){
            //do secured user stuff
        } else {
            //throw error
        }
    });
});
```

# Usage: Client Side

Since we're not using cookies, we have to do a little work on the client to initialize the session -- including storing
the session token.  Since my goal was to use this with a compiled app, local storage seemed like a good choice for the
store. All we need to do is emit a "**getToken**" event and listen for a "**gotToken**" event.

### Example
```javascript

var socket = io("http://your.server.here"),
    token = localStorage.getItem("token") || "";

socket.emit("getToken", {token: localStorage.getItem("token") || ""});

socket.on("gotToken", function(message){
    console.log(message);
    if(message.token != "") {
        localStorage.setItem("token", message.token);
        token = message.token;
    }
});
```
That's it.  You're now using sessions with websockets :).

# Note

This middleware does *NOT* create its own database table.  I'm of the mindeset that apps shouldn't ever have that level
of database access, so you need to create it on your own.  You'll get the create statement back in error messages if it
encounters an error, but here it is:

```sql

CREATE TABLE `session` (
  `sessionId` varchar(32) COLLATE utf8_bin NOT NULL,
  `expires` int(11) unsigned NOT NULL,
  `data` text COLLATE utf8_bin,
  PRIMARY KEY (`sessionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_bin;

```