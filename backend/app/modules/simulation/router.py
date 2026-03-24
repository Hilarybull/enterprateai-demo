from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.modules.simulation.schemas import SimulationRunRequest, SimulationRunResponse
from app.modules.simulation.service import run_simulation
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/simulation", tags=["simulation"])


@router.post("/run", response_model=SimulationRunResponse)
async def simulation_run(payload: SimulationRunRequest, _user=Depends(get_current_user)) -> SimulationRunResponse:
    try:
        result = run_simulation(payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return SimulationRunResponse(**result)

