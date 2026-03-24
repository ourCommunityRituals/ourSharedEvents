#!/bin/bash
cp Admin.html Admin.html.bak
awk '{gsub(/alert`Error:/, "alert(`Error:"); print}' Admin.html.bak > Admin.html
