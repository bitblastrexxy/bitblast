


let slideIndex = 0;
showSlides();

// Function to show the slides
function showSlides() {
    let i;
    const slides = document.getElementsByClassName("mySlides");
    const dots = document.getElementsByClassName("dot");

    for (i = 0; i < slides.length; i++) {
        slides[i].style.display = "none";  
    }
    slideIndex++;
    if (slideIndex > slides.length) {slideIndex = 1}    

    for (i = 0; i < dots.length; i++) {
        dots[i].className = dots[i].className.replace(" active", "");
    }

    slides[slideIndex - 1].style.display = "block";  
    dots[slideIndex - 1].className += " active";
    
    setTimeout(showSlides, 4000); // Change image every 3 seconds
}

// Function to show the selected slide when clicking on a dot
function currentSlide(n) {
    slideIndex = n;
    showSlides();
}




          // Restrict deposit amount based on selected plan
          document.addEventListener('DOMContentLoaded', function() {
            const depositAmountInput = document.getElementById('deposit-amount');
            const depositButton = document.getElementById('deposit-button');
            const depositError = document.getElementById('deposit-error');
            const planRadioButtons = document.querySelectorAll('input[name="plan"]');
            
            const planLimits = {
                'plan-1': { min: 50, max: 999 },
                'plan-2': { min: 1000, max: 4999 },
                'plan-3': { min: 5000, max: Infinity }
            };

            let selectedPlan = null;

            planRadioButtons.forEach(radio => {
                radio.addEventListener('change', function() {
                    selectedPlan = planLimits[this.value];
                    depositError.textContent = ''; // Clear any previous errors
                });
            });

            depositButton.addEventListener('click', function(event) {
                event.preventDefault();
                const depositAmount = parseFloat(depositAmountInput.value);

                if (selectedPlan) {
                    if (depositAmount < selectedPlan.min || depositAmount > selectedPlan.max) {
                        depositError.textContent = `Deposit amount must be between $${selectedPlan.min} and $${selectedPlan.max}`;
                    } else {
                        // Proceed with form submission
                        depositError.textContent = ''; // Clear error
                        // You can submit the form here or do further processing
                    }
                } else {
                    depositError.textContent = 'Please select a plan';
                }
            });
});
