# =====================================================================
# gallery.py — opens the Doodle Gallery here on this PC, for testing. Double-click it.
# It starts the Workshop's server (Workshop/workshop.py: one server for both) and opens the gallery at
# localhost:8080/HangoutRoom/. Leave the black window open; every refresh shows the latest files, so there's nothing
# to upload while testing. Close the black window to stop it.
# =====================================================================
import os, runpy, sys

sys.argv = [sys.argv[0], 'gallery']
runpy.run_path(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Workshop', 'workshop.py'),
               run_name='__main__')
