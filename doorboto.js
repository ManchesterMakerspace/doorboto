// accessBot.js ~ Copyright 2016 Manchester Makerspace ~ License MIT
var slack = require('./doorboto_modules/slack_intergration.js');  // get slack send and invite methodes requires('request')
var mongo = require('./doorboto_modules/mongo.js');               // grab mongoose schema and connect methods
var RETRY_DELAY = 5000;                                           // when to try again if no connection

var arduino = {                        // does not need to be connected to and arduino, will try to connect to one though
    serialLib: require('serialport'),  // yun DO NOT NPM INSTALL -> opkg install node-serialport, use global lib
    init: function(arduinoPort){
        arduino.serial = new arduino.serialLib.SerialPort(arduinoPort, {
            baudrate: 9600,           // remember to set you sketch to go this same speed
            parser: arduino.serialLib.parsers.readline('\n')
        });
        arduino.serial.on('open', arduino.open);
        arduino.serial.on('data', arduino.read);
        arduino.serial.on('close', arduino.close);
        arduino.serial.on('error', arduino.error);
    },
    open: function(){console.log('connected to something');},                   // what to do when serial connection opens up with arduino
    read: function(data){                           // when we get data from Arduino, we basical only expect a card ID
        data = data.slice(0, data.length-1);        // exclude newline char from card ID
        var authFunction = auth.orize(arduino.grantAccess, arduino.denyAccess); // create authorization function
        authFunction({machine: process.env.MACHINE_NAME, card: data});          // use authorization function
    },
    close: function(){arduino.init();},              // try to re-establish if serial connection is interupted
    error: function(error){                          // given something went wrong try to re-establish connection
        setTimeout(arduino.init, RETRY_DELAY);       // retry every half a minute NOTE this will keep a heroku server awake
    },
    grantAccess: function(memberName){               // is called on successful authorization
        arduino.serial.write('<a>');                 // a char grants access: wakkas help arduino know this is a distinct command
        slack.send(memberName + ' just checked in'); // let members know through slack
    },
    denyAccess: function(msg){                       // is called on failed authorization
        arduino.serial.write('<d>');                 // d char denies access: wakkas help arduino know this is a distinct command
        slack.send(msg + ': denied access');         // let members know through slack
    }
};


var auth = {                                                                  // depends on mongo and sockets: authorization events
    orize: function(success, fail){                                           // takes functions for success and fail cases
        return function(data){                                                // return pointer to event handler that recieves credentials
            mongo.bot.findOne({machineID: data.machine}, auth.foundBot(data, success, fail));
        };                                                                    // first find out which bot we are dealing with
    },
    foundBot: function(data, success, fail){                                  // callback for when a bot is found in db
        return function(error, bot){                                          // return a pointer to this function to keep params in closure
            if(error){fail('Card reader:' + error);}
            else if(bot){ mongo.member.findOne({cardID: data.card}, auth.foundMember(data, success, fail));}
            else {
                sockets.io.emit('regBot', data.machine);                      // signal an interface prompt for registering bots
                fail('New card reader?');
            }
        };
    },
    foundMember: function(data, success, fail){                                           // callback for when a member is found in db
        return function(error, member){
            if(error){fail('finding member issue:' + error);}
            else if (member){
                sockets.io.emit('memberScan', member);                                    // member scan.. just like going to the airport
                if (auth.checkAccess(data.machine, member.accesspoints)){
                    if(member.status === 'Revoked'){
                        fail(member.fullname + ', talk to board ');                       // PC message for Revoked members
                    } else if (member.groupName){                                         // if this member is part of a group membership
                        mongo.member.findOne({groupName: member.groupName, groupKeystone: true}, auth.foundGroup(data, member.fullname, success, fail));
                    } else { auth.checkExpiry(member, member.fullname, success, fail); }  // given no group, no error, and good in standing
                } else {fail( member.fullname + ' not authorized on ' + data.machine);}   // else no machine match
            } else {
                sockets.io.emit('regMember', {cardID: data.card, machine: data.machine}); // emit reg info to admin
                fail('unregistered member');                                              // given them proper credentials to put in db
            }
        };
    },
    foundGroup: function(data, memberName, success, fail){                                // callback for when a group is found in db
        return function(error, group){
            if(error)      {fail( memberName + ' finding group admin:' + error);} // very improbable
            else if (group){auth.checkExpiry(group, memberName, success, fail);}  // check keystone members expiration date
            else           {fail( memberName + ' no group admin');}               // this should never occur
        };
    },
    checkExpiry: function(member, memberName, success, fail){
        if(new Date().getTime() > new Date(member.expirationTime).getTime()){ // if membership expired
            fail(member.fullname + "'s membership expired");                  // Notify expiration
        } else { success(memberName); }                                       // otherwise, LET THEM IN!!!!
    },
    checkAccess: function(machine, authorized){                               // takes current machine and array of authorized machines
        for(var i = 0; i < authorized.length; i++){                           // against all authorized machines
            if(authorized[i] === machine){return true;}                       // is this member authorized for this machine
        }
        return false;                                                         // given no matches they are not authorized
    }
};


var update = {                // requires mongo and sockets
    renew: function(member){
        mongo.member.findOne({fullname: member.fullname}, function(error, existingMember){
            if(error){sockets.io.emit('message', 'renew issue: ' + error);}       // case of db error, report failure to admin
            else if (existingMember){                                             // case things are going right
                existingMember.expirationTime = member.expirationTime;            // set new expiration time
                existingMember.save(search.updateCallback('renewed membership')); // save and on save note success to admin
            } else { sockets.io.emit('message', 'Inconcievable!');}               // I don't think that word means what you think it means
        });
    },
};

var search = {                 // depends on mongo and sockets
    findAny: function(query){  // not functional yet this will be for listing members
        var cursor = mongo.member.find(query).cursor();
        cursor.on('data', function gotData(member){
            sockets.io.emit('foundMember', member);
        });
        cursor.on('close', function doneListingMembers(){
            console.log('done listing members');
        });
    },
    find: function(query){  // response to member searches in admin client
        mongo.member.findOne({fullname: query}, function(err, member){
            if(err)         { sockets.io.emit('message', 'search issue: ' + err); }
            else if(member) { sockets.io.emit('found', member); }
            else            { sockets.io.emit('message', 'no member with that name, maybe bad spelling?');}
        });
    },
    revokeAll: function(fullname){
        mongo.member.findOne({fullname: fullname}, function(err, member){
            if(err){
                sockets.io.emit('message', 'search issue: ' + err);
            }else if(member){
                member.status = 'Revoked'; // set no acces to anything
                member.save(search.updateCallback('member revoked'));
            } else { sockets.io.emit('message', 'Inconcievable!');}       // you keep using that word...
        });
    },
    updateCallback: function(msg){ // returns a custom callback for save events
        return function(err){
            if(err){ sockets.io.emit('message', 'update issue:' + err); }
            else { sockets.io.emit('message', msg); }
        };
    },
    group: function(groupName){
        mongo.member.findOne({groupName: groupName, groupKeystone: true}, function(error, member){
            if(error){ sockets.io.emit('message', 'find group issue:' + error);}
            else if (member){
                sockets.io.emit('foundGroup', {exist: true, expirationTime: member.expirationTime});
            } else { sockets.io.emit('foundGroup', {exist: false}); }
        });
    }
};

var register = {                                                 // requires mongo, sockets
    member: function(registration){                              // registration event
        var member = new mongo.member(registration);             // create member from registration object
        member.save(                                             // yes this is a function that takes a function that takes a function
            register.response(function(){slack.invite(registration.email, registration.fullname);})
        );                                                       // save method of member scheme: write to mongo!
    },
    newPayment: function(newPayment){                            // conform to schema at payment listener
        var payment = new mongo.payment(newPayment);             // model out a new doc to write to mongo
        payment.save(register.reponse);                          // get a function that handles a generic error and succes case
    },
    bot: function(robot){
        var bot = new mongo.bot(robot);                          // create a new bot w/info recieved from client/admin
        bot.save(register.response);                             // save method of bot scheme: write to mongo!
    },
    response: function(succesFunction){
        return function(error){                                          // callback for member save
            if(error){ sockets.io.emit('message', 'error:' + error); }   // given a write error
            else {
                if(succesFunction){succesFunction();}                    // given a succes case run it
                sockets.io.emit('message', 'save success');              // show save happened to web app
            }
        };
    },
};

var sockets = {                                                           // depends on slack, register, search, auth: handle socket events
    io: require('socket.io'),
    listen: function(server){
        sockets.io = sockets.io(server);
        sockets.io.on('connection', function(socket){                     // when any socket connects to us
            socket.on('newMember', register.member);                      // in event of new registration
            socket.on('newBot', register.bot);                            // event new bot is registered
            socket.on('find', search.find);                               // event admin client looks to find a member
            socket.on('revokeAll', search.revokeAll);                     // admin client revokes member privilages
            // bots should probably have to give us a shared key for next event handler to work
            socket.on('auth', auth.orize(sockets.grantAccess(socket), sockets.denyAccess(socket)));
                              // get auth event handler by passing success & fail callbacks
            socket.on('renew', update.renew);                             // renewal is passed from admin client
            socket.on('findGroup', search.group);                         // find to to register under a group
        });
    },
    grantAccess: function(socket){
        return function(memberName){                                    // is called on successful authorization
            sockets.io.to(socket.id).emit('auth', 'a');
            slack.send(memberName + ' just checked in');
        };
    },
    denyAccess: function(socket){
        return function(msg){                                            // is called on failed authorization
            sockets.io.to(socket.id).emit('auth', 'd');
            slack.send(msg + ': denied access');
        };
    }
};
/*
var routes = {                                                            // depends on auth: handles routes
    auth: function(req, res){                                             // get route that acccess control machine pings
        auth.orize(routes.grantAccess(res), routes.denyAccess(res))(req.params);    // create auth event handler & execute it against credentials
    },
    grantAccess: function(res){
        return function success(memberName){                            // route callback for granting access
            res.status(200).send('a');
            slack.send(memberName + ' just checked in');
        };
    },
    denyAccess: function(res){
        return function (msg){                                           // route callback for denying access
            res.status(403).send(msg + ": denied access");
            slack.send(msg + ': denied access');
        };
    }
};

var serve = {                                                // depends on cookie, routes, sockets: handles express server setup
    express: require('express'),                             // server framework library
    theSite: function (){                                    // methode call to serve site
        var app = serve.express();                           // create famework object
        var http = require('http').Server(app);              // http server for express framework
        var router = serve.express.Router();                 // create express router object to add routing events to
        if(process.env.TESTING_MA === 'true'){
            router.get('/:machine/:card', routes.auth);      // authentication route
        }
        app.use(router);                                     // get express to user the routes we set
        return http;
    }
}; */

// High level start up sequence
slack.init(process.env.BROADCAST_CHANNEL, 'Doorboto2 started');// fire up slack intergration, for x channel
arduino.init(process.env.SERIALPORT);                          // connect to arduino
mongo.softStart(process.env.MONGODB_URI, function onFail(error){ // if we fail to intialy connect to mongo it will keep trying
    slack.sendAndLog(error + ': fail to connect to ' + db_uri);
});
// mongo.init(process.env.MONGODB_URI);                        // connect to our mongo server NOTE: this currently kills server on no connection
// var server = require('http')(require('express')());         // example set up http server
// var server = serve.theSite();                               // set up post
var server = require('net').createServer();                    // lets see if this is more light weight than express
sockets.listen(server);                                        // listen and handle socket connections
server.listen(process.env.PORT);                               // listen on specified PORT enviornment variable
// TODO close database and socket connections gracefully on sigint signal
