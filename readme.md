To setup the dependencies required for accessBot, ensure you cd to ./Server/ and run the following script:
sudo./setup.sh

To run the server, environment variables are needed!

Here is a small shell script that sets up said variables

    #!/bin/bash
    # script for starting our accessBot
    export PORT="3000"
    # decrypting client side cookies
    export SESSION_SECRET="putyoursupperawesomesecretrighthere"
    # uri of mongo database to be used
    export MONGODB_URI="mongodb://localhost/makerauth"
    #password for root, make live one something better than this
    export MASTER_PASS="monkey"
    # URL for slack webhook intergration (basically auth you need to be a bot)
    export SLACK_WEBHOOK_URL="www.putTheWebHookURLHere.com"
    # individual token for slack (in this case we need to act as an administrator to invite new members)
    export SLACK_TOKEN="putYourTokenHere"
    # server for recieving payment notifications
    export PAYMENT_NOTIFICATION_SERVER = "http://urIPNserver"
    # State whether testing application or not
    export TESTING_MA="true"
    export SERIALPORT="/dev/ttyATH0" # SerialPort for Arduino Yun
    export MACHINE_NAME="dorboto"    # Name of that is trying to let in a user

    echo "Starting the accessBot!"
    if [ $TESTING_MA == "true" ]; then
        export BROADCAST_CHANNEL="test_channel" # have a test channel to broadcast on
        nodemon accessBot.js
        # reloads server on source change -> sudo npm install -g nodemon
    else
        export BROADCAST_CHANNEL="prod_channel" # have a prod channel to broadcast on
        npm install
        # probably want to make sure npm install is run when upgrading dorboto
        pm2 start accessBot.js
        # backgrounds process
    fi

"nano start.sh" in Sever this folder, add above code with your own parameters, ctrl-x to save, and "chmod +x start.sh"

To start the server run ./start.sh
