// accessBot.js ~ Copyright 2016 Manchester Makerspace ~ License MIT
var slack = require('./doorboto_modules/slack_intergration.js');              // get slack send and invite methodes
var mongo = require('./doorboto_modules/mongo.js');                           // grab mongoose schema and connect methods

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


/* var ioClient = { // Prototype IPN listener connection
    socket: require('socket.io-client')(process.env.PAYMENT_NOTIFICATION_SERVER),
    init: function(){ // notify authorization or denial: make sure arduino has start and end chars to read
        // probably put something here to authenticate with server that this is real doorboto
        ioClient.socket.emit('authenticate', process.env.DOORBOTO_TOKEN); // authenticate w/relay server
        //  ioClient.socket.on('paymentMade', ioClient.paymentMade);
    },
    paymentMade: function(data){
        // add made payment to data base to either renew or add a pending card holder
    }
}; */

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
            socket.on('auth', auth.orize(sockets.grantAccess, sockets.denyAccess));
                              // get auth event handler by passing success & fail callbacks
            socket.on('renew', update.renew);                             // renewal is passed from admin client
            socket.on('findGroup', search.group);                         // find to to register under a group
        });
    },
    grantAccess: function(memberName){                                    // is called on successful authorization
        sockets.io.to(socket.id).emit('auth', 'a');
        slack.send(memberName + ' just checked in');
    },
    denyAccess: function(msg){                                            // is called on failed authorization
        sockets.io.to(socket.id).emit('auth', 'd');
        slack.send(msg + ': denied access');
    }
};

var routes = {                                                            // depends on auth: handles routes
    auth: function(req, res){                                             // get route that acccess control machine pings
        auth.orize(routes.grantAccess, routes.denyAccess)(req.params);    // create auth event handler & execute it against credentials
    },
    admin: function(req, res){                                            // post by potential admin request to sign into system
        if(req.body.fullname === 'admin' && req.body.password === process.env.MASTER_PASS){
            res.render('register', {csrfToken: req.csrfToken()});
        } else {res.send('denied');}                                      // YOU SHALL NOT PASS.. maybe a redirect(/) would be more helpful
    },
    login: function(req, res){res.render('signin', {csrfToken: req.csrfToken()});}, // get request to sign into system
    grantAccess: function success(memberName){                            // route callback for granting access
        res.status(200).send('a');
        slack.send(memberName + ' just checked in');
    },
    denyAccess: function (msg){                                           // route callback for denying access
        res.status(403).send(msg + ": denied access");
        slack.send(msg + ': denied access');
    }
};

var cookie = {                                               // Admin authentication / depends on client-sessions
    session: require('client-sessions'),                     // mozilla's cookie library
    ingredients: {                                           // personally I prefer chocolate chips
        cookieName: 'session',                               // guess we could call this something different
        secret: process.env.SESSION_SECRET,                  // do not track secret in version control
        duration: 7 * 24  * 60 * 60 * 1000,                  // cookie times out in x amount of time
    },
    meWant: function(){return cookie.session(cookie.ingredients);}, // nom nom nom!
    decode: function(content){return cookie.session.util.decode(cookie.ingredients, content);},
};

var serve = {                                                // depends on cookie, routes, sockets: handles express server setup
    express: require('express'),                             // server framework library
    parse: require('body-parser'),                           // JSON parsing library
    theSite: function (){                                    // methode call to serve site
        var app = serve.express();                           // create famework object
        var http = require('http').Server(app);              // http server for express framework
        app.set('view engine', 'jade');                      // use jade to template html files, because bad defaults
        app.use(require('compression')());                   // gzipping for requested pages
        app.use(serve.parse.json());                         // support JSON-encoded bodies
        app.use(serve.parse.urlencoded({extended: true}));   // support URL-encoded bodies
        app.use(cookie.meWant());                            // support for cookies (admin auth)
        app.use(require('csurf')());                         // Cross site request forgery tokens (admin auth)
        app.use(serve.express.static(__dirname + '/views')); // serve page dependancies (sockets, jquery, bootstrap)
        var router = serve.express.Router();                 // create express router object to add routing events to
        router.get('/', routes.login);                       // log in page
        router.post('/', routes.admin);                      // request registration page
        if(process.env.TESTING_MA){
            router.get('/:machine/:card', routes.auth);      // authentication route
        }
        app.use(router);                                     // get express to user the routes we set
        return http;
    }
};

// High level start up sequence
mongo.init(process.env.MONGODB_URI);                          // conect to our mongo server
var http = serve.theSite();                                   // Set up site framework
sockets.listen(http);                                         // listen and handle socket connections
http.listen(process.env.PORT);                                // listen on specified PORT enviornment variable
slack.init(process.env.BROADCAST_CHANNEL, 'Doorboto started');// fire up slack intergration, for x channel

// TODO close database and socket connections gracefully on sigint signal
