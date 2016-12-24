# Following commands should set up the proper enviornment for ubuntu 16.04 round abouts
# this script will need to be run as sudo

curl -sL https://deb.nodesource.com/setup_4.x | sudo -E bash -

echo "bringing package list up to date"
apt-get update

echo "Installing NodeJS"
apt-get install -y nodejs

echo "Installing build-essential"
apt-get install -y build-essential

echo "Installing MongoDB"
apt-get install -y mongodb

echo "Installing pm2"
npm install -g pm2

echo "Installing nodemon"
npm install -g nodemon

echo "Installing Dependencies"
npm install
