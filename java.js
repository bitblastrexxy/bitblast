// Slide in tabs when scrolling to About Us section
const aboutUsSection = document.querySelector('.about-us-section');
const tabsContainer = document.querySelector('.tabs-container');
const stats = document.querySelectorAll('.count');
let statsStarted = false;

window.addEventListener('scroll', () => {
    const aboutUsTop = aboutUsSection.getBoundingClientRect().top;
    const windowHeight = window.innerHeight;

    if (aboutUsTop < windowHeight - 100) {
        tabsContainer.classList.add('active');
    }

    // Animate stats counting up
    const statsSection = document.querySelector('#statistics');
    const statsTop = statsSection.getBoundingClientRect().top;

    if (statsTop < windowHeight - 100 && !statsStarted) {
        statsStarted = true;
        stats.forEach(stat => {
            const target = +stat.getAttribute('data-target');
            const increment = target / 200;

            const updateCount = () => {
                const current = +stat.innerText;

                if (current < target) {
                    stat.innerText = Math.ceil(current + increment);
                    setTimeout(updateCount, 20);
                } else {
                    stat.innerText = target;
                }
            };

            updateCount();
        });
    }
});
