import React, { useState } from 'react';

const ServiceSelector = () => {
    const [selectedServices, setSelectedServices] = useState([]);
    const [customService, setCustomService] = useState('');

    const services = ['Service A', 'Service B', 'Service C'];

    const handleCheckboxChange = (service) => {
        setSelectedServices(prevSelected => {
            if (prevSelected.includes(service)) {
                return prevSelected.filter(s => s !== service);
            } else {
                return [...prevSelected, service];
            }
        });
    };

    const handleAddCustomService = () => {
        if (customService && !selectedServices.includes(customService)) {
            setSelectedServices([...selectedServices, customService]);
            setCustomService(''); // Clear input after adding
        }
    };

    return (
        <div>
            <h3>Select Services</h3>
            {services.map(service => (
                <div key={service}>
                    <label>
                        <input 
                            type="checkbox" 
                            value={service} 
                            checked={selectedServices.includes(service)} 
                            onChange={() => handleCheckboxChange(service)}
                        />
                        {service}
                    </label>
                </div>
            ))}
            <div>
                <input 
                    type="text" 
                    value={customService} 
                    onChange={(e) => setCustomService(e.target.value)} 
                    placeholder="Add custom service" 
                />
                <button onClick={handleAddCustomService}>Add</button>
            </div>
            <h4>Selected Services:</h4>
            <ul>
                {selectedServices.map(service => (<li key={service}>{service}</li>))}
            </ul>
        </div>
    );
};

export default ServiceSelector;
