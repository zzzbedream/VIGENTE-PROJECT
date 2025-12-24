from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class ConsentRequest(BaseModel):
    rut: str
    partner_id: str

@app.post("/consent")
def consent(req: ConsentRequest):
    # Simulate consent check: allow if rut includes '-' and partner_id non-empty
    if "-" not in req.rut or not req.partner_id:
        raise HTTPException(status_code=400, detail="Invalid request")
    return {"consent": True, "rut": req.rut, "partner_id": req.partner_id}
