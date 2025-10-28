services:
  - type: web
    name: goldenprice-backend
    env: node
    plan: free
    region: oregon
    buildCommand: "npm install"
    startCommand: "npm start"
    envVars:
      - key: PORT
        value: "10000"
      # ممكن تسيب المفاتيح فاضية هنا وتضيفها من Dashboard
      - key: API_NINJAS_KEY
        sync: false
      - key: TWELVEDATA_KEY
        sync: false
      - key: ALPHAVANTAGE_KEY
        sync: false
      - key: MARKETSTACK_KEY
        sync: false
      - key: GOLDAPI_KEY
        sync: false
      - key: GOLDPRICEZ_KEY
        sync: false
      - key: FMP_KEY
        sync: false
