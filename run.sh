git fetch origin && git reset --hard origin/$(git branch --show-current)
git pull
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
clear
echo "Starting backend on port $PORT..."
export FLASK_APP=serve.py
echo "Running server"
python3 serve.py