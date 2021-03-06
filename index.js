var _ = require("underscore"),
    uid = require("uid-safe"),
    util = require("util");

/**
 * Socket.io Session Object - uses mysql for a session store.
 * @type {Function}
 */
var Session = function(options){

    /**
     * Options object
     * Default options:
     *    expiration: 86400000
     *    logger: {
     *       log: function(){}
     *    }
     *
     * provide a filelogger object (found on npm) to integrate logging from this class into your application.
     * @type {*|{}}
     */
    this.options = _.extend(
        (options || {}),
        {
            expiration: 86400000,
            logger: {
                log: function(){}
            }
        });

    if(_.isUndefined(options.db)){
        throw("Database connection must be provided through options.db");
    }

    /**
     * Mysql Database connection
     */
    this.db = options.db;

    /**
     * Filelogger object
     * @type filelogger
     */
    this.logger = options.logger;

    /**
     * Session Values
     * @type {{}}
     */
    this.values = {};

    /**
     * session token/id
     * @type {string}
     */
    this.token = "";

    /**
     * Generates sql string to run to create the table that is needed for this class.
     * @returns {string}
     * @private
     */
    this._dbCreateError = function(){
        this.logger.log("debug", "Socket.io-mysql-session: display db create script");

        return "CREATE TABLE `session` (\n" +
               "    `sessionId` varchar(32) COLLATE utf8_bin NOT NULL,\n" +
               "    `expires` int(11) unsigned NOT NULL,\n" +
               "    `data` text COLLATE utf8_bin,\n" +
               "    PRIMARY KEY (`sessionId`)\n" +
               ") ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_bin;";
    };

    /**
     * Generates Expires timestamp
     * @private
     */
    this._generateExpires = function(){
        this.logger.log("debug", "Socket.io-mysql-session: generating expires");
        return Math.round((new Date(Date.now() + this.options.expiration).getTime() / 1000));
    };

    /**
     * session Expiration
     * @type {Date}
     */
    this.expires = this._generateExpires();

    /**
     * saves session info back to the db
     * @private
     */
    this._saveSession = function(){
        this.logger.log("debug", "Socket.io-mysql-session: saving session");

        var params,
            sessionData = JSON.stringify(this.values),
            sql,
            expires = this._generateExpires();

        sql = "INSERT INTO session " +
              "(sessionId, expires, data) " +
              "VALUES " +
              "(?, ?, ?) " +
              "ON DUPLICATE KEY UPDATE " +
                  "expires = ?, " +
                  "data = ?";
        params = [
            this.token,
            expires,
            sessionData,
            expires,
            sessionData,
        ];

        this.logger.log("debug", "Socket.io-mysql-session: query: " + this.db.format(sql, params));

        if(this.token != ""){
            this.db.query(sql, params, _.bind(function(error, results, fields){
                if(_.isUndefined(results)){
                    this.logger.log("error", "Socket.io-mysql-session: unable to save session. You might need to create the table. \n" +
                    this._dbCreateError());
                    this.logger.log("error", util.inspect(error));
                }
            }, this));
        } else {
            this.logger.log("error", "Token is empty.");
        }
    };


    /**
     * loads a session (or generates a new one if expired/not found) and calls the passed in callback to act on the results
     * @param callback
     * @private
     */
    this._loadSession = function(callback) {
        this.logger.log("debug", "Socket.io-mysql-session: loading session");
        var sql = "SELECT * FROM session " +
                  "WHERE " +
                  "sessionId = ?";
        this.logger.log("debug", "Socket.io-mysql-session: query: " + this.db.format(sql, [this.token]));
        this.db.query(sql, [this.token], _.bind(function (error, results, fields) {
            var generateNew = false,
                message = "";

            if(!_.isUndefined(results) && results.length > 0){
                this.values = JSON.parse(results[0].data);
                this.expires = results[0].expires;
                if(this._isExpired()){
                    this.logger.log("debug", "Socket.io-mysql-session: session expired");
                    message = "Session Expired";
                    generateNew = true;
                }
            } else if(!_.isUndefined(results) && results.length == 0){
                this.logger.log("debug", "Socket.io-mysql-session: session expired");
                message = "Session Not Found";
                generateNew = true;
            } else {
                this.token = "";
                message = "Something terrible happened\n" + util.inspect(error);
                this.logger.log("error", "Socket.io-mysql-session: " + message);
            }

            if(generateNew){
                this.token = uid.sync(24);
                this.expires = this._generateExpires();
                this._saveSession();
            }

            if(_.isFunction(callback)){
                callback(this.token, message);
            }

        }, this));
    }

    /**
     * Checks to see if the retrieved session is expired.
     * @returns {boolean}
     * @private
     */
    this._isExpired = function(){
        this.logger.log("debug", "Socket.io-mysql-session: _isExpired");
        var now = Math.round((new Date(Date.now()).getTime() / 1000));
        return (now > this.expires)? true : false;
    }
}

/**
 * Sets a value to a particular key in the session.
 * @param key
 * @param value
 */
Session.prototype.set = function(key, value){
    this.logger.log("debug", "Socket.io-mysql-session: setting " + key + " to session.");
    this.values[key] = value;
    this._saveSession();
}

/**
 *
 * @param key
 * @returns {string}
 */
Session.prototype.get = function(key){
    this.logger.log("debug", "Socket.io-mysql-session: getting " + key + " from session.");
    return (_.isUndefined(this.values[key])) ? "" : this.values[key];
}

/**
 * Generates a new token and returns it to the caller.  If an existing token is passed, that session is loaded.
 * @param token token to load
 * @param callback callback to call after the token is loaded.  This will be called with Token and an error message
 *
 * callback(token, error);
 *
 * The callback should emit one or the other of those.
 */
Session.prototype.loadSession = function(token, callback){
    this.logger.log("debug", "Socket.io-mysql-session: loadSession");

    if(_.isUndefined(token) && _.isEqual(token, "")){
        this.token = uid.sync(24);
        this._saveSession();
        callback(token, "");
    } else {
        this.token = token;
        this._loadSession(callback);
    }
}

/**
 * clears session data from the socket connection.
 */
Session.prototype.clearSession = function(){
    this.values = {};
    this._saveSession();
}

var ioSession = module.exports = function(options){
    /**
     * Options object
     * Default options:
     *    expiration: 86400000
     *    logger: {
     *       log: function(){}
     *    }
     *
     * provide a filelogger object (found on npm) to integrate logging from this class into your application.
     * @type {*|{}}
     */
    this.options = _.extend(
        (options || {}),
        {
            expiration: 86400000,
            logger: {
                log: function(){}
            }
        });

    /**
     * Filelogger object
     * @type filelogger
     */
    this.logger = options.logger;

    //return middleware
    return _.bind(function(socket, next){
        this.logger.log("debug", "Socket.io-mysql-session: middleware bound to socket");
        socket.session = new Session(options);
        socket.on("getToken", _.bind(function(params){
            params = params || {token: ""};
            this.logger.log("debug", "Socket.io-mysql-session: getToken [" + params.token + "]");
            var userToken = params.token;
            socket.session.loadSession(userToken, function(token, errors){
                socket.emit("gotToken", {token: token, errors: errors});
            });
        }, this));
        next();
    }, this);
}

