#!/bin/bash

sudo systemctl stop UploaderService

dotnet publish --configuration Release

sudo rm -rf /var/www/UploaderService/*

sudo cp /home/hugh/repos/BreakTackle/Backend/UploaderService/bin/Release/net7.0/publish/* /var/www/UploaderService -r

sudo systemctl start UploaderService

sudo systemctl status UploaderService